import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Images, Play, Maximize2 } from 'lucide-react';

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

// Renders text with highlighted hashtags
function PostText({ text }) {
  if (!text) return null;
  const parts = text.split(/(#\S+)/g);
  return (
    <p className="modal-post-content">
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <span key={i} className="hashtag">{part}</span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </p>
  );
}

export default function PostModal({ post, onClose }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const media = post.media || [];
  const hasMedia = media.length > 0;

  const formattedDate = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(post.date));

  const prev = useCallback(() => {
    setActiveIndex(i => (i - 1 + media.length) % media.length);
  }, [media.length]);

  const next = useCallback(() => {
    setActiveIndex(i => (i + 1) % media.length);
  }, [media.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      // Don't close the entire modal if the lightbox is open
      if (isLightboxOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next, isLightboxOpen]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const currentSrcItem = media[activeIndex];
  const currentSrc = typeof currentSrcItem === 'string' ? currentSrcItem : (currentSrcItem?.publicUrl || currentSrcItem?.uri || '');
  const isVideo = currentSrc && (currentSrc.endsWith('.mp4') || currentSrc.endsWith('.mov') || currentSrc.endsWith('.webm'));

  // Slides for Lightbox (filters out videos gracefully as Lightbox expects images primarily, or we supply custom render. For native Lightbox, just pictures)
  // Let's just feed it everything and it will show generic placeholder for videos, but we can just map simple objects.
  const lightboxSlides = media.map(m => {
    const src = typeof m === 'string' ? m : (m.publicUrl || m.uri || '');
    return { src: src.startsWith('http') ? src : src.replace(/ /g, '%20'), type: (src.endsWith('.mp4') || src.endsWith('.mov')) ? 'video' : 'image' };
  }).filter(m => m.type === 'image'); // filter to images only to keep the lightbox simple

  // Find index in lightbox array corresponding to current displayed media
  const currentLightboxIndex = lightboxSlides.findIndex(slide => slide.src === (currentSrc.startsWith('http') ? currentSrc : currentSrc.replace(/ /g, '%20')));

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Post detail">
      <button
        className="modal-close"
        onClick={onClose}
        aria-label="Close post"
      >
        <X size={18} />
      </button>

      <div className="modal-body" onClick={e => e.stopPropagation()}>
        {/* ── Media Pane ── */}
        <div className="modal-media-pane">
          {hasMedia ? (
            <>
              {isVideo ? (
                <video
                  key={currentSrc}
                  className="modal-main-video"
                  src={currentSrc.startsWith('http') ? currentSrc : currentSrc.replace(/ /g, '%20')}
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    key={currentSrc}
                    className="modal-main-media"
                    src={currentSrc.startsWith('http') ? currentSrc : currentSrc.replace(/ /g, '%20')}
                    alt={`Photo ${activeIndex + 1} of ${media.length}`}
                    onClick={() => setIsLightboxOpen(true)}
                    style={{ cursor: 'zoom-in' }}
                  />
                  <button 
                    className="zoom-btn"
                    onClick={() => setIsLightboxOpen(true)}
                    style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', padding: 8, borderRadius: 4, cursor: 'pointer', zIndex: 10, backdropFilter: 'blur(4px)' }}
                    title="View Fullscreen"
                  >
                    <Maximize2 size={18} />
                  </button>
                </div>
              )}

              {media.length > 1 && (
                <>
                  <button className="modal-nav-btn prev" onClick={prev} aria-label="Previous image">
                    <ChevronLeft size={20} />
                  </button>
                  <button className="modal-nav-btn next" onClick={next} aria-label="Next image">
                    <ChevronRight size={20} />
                  </button>

                  {/* Thumbnail strip */}
                  <div className="modal-thumb-strip">
                    {media.map((srcItem, i) => {
                      const src = typeof srcItem === 'string' ? srcItem : (srcItem?.publicUrl || srcItem?.uri || '');
                      const isVid = src.endsWith('.mp4') || src.endsWith('.mov') || src.endsWith('.webm');
                      return (
                        <div
                          key={i}
                          className={`modal-thumb-wrap ${activeIndex === i ? 'active' : ''}`}
                          onClick={() => setActiveIndex(i)}
                        >
                          {isVid ? (
                            <div className="modal-thumb" style={{ background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Play size={16} color="white" />
                            </div>
                          ) : (
                            <img
                              className="modal-thumb"
                              src={src.startsWith('http') ? src : src.replace(/ /g, '%20')}
                              alt={`Thumb ${i + 1}`}
                              loading="lazy"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#666' }}>
              No media attached
            </div>
          )}
        </div>

        {/* ── Info Pane ── */}
        <div className="modal-info-pane">
          <div className="modal-info-header">
            <div className="modal-avatar">M</div>
            <div>
              <div className="modal-author">Madhu Jagdhish</div>
              <div className="modal-date">{formattedDate}</div>
            </div>
          </div>

          <div className="modal-info-content">
            {post.temple_name && (
              <h2 className="modal-temple-name">{post.temple_name}</h2>
            )}
            
            {(post.dynasty || post.deity || post.architectural_style) && (
              <div className="modal-meta-badges">
                {post.dynasty && <span className="meta-badge">{post.dynasty}</span>}
                {post.deity && <span className="meta-badge">{post.deity}</span>}
                {post.architectural_style && <span className="meta-badge">{post.architectural_style}</span>}
              </div>
            )}

            {(post.historical_period?.label || post.construction_duration?.label) && (
              <div className="modal-meta-list" style={{ marginBottom: '1rem' }}>
                {post.historical_period?.label && (
                  <div className="modal-meta-detail">
                    <span className="meta-label">Era:</span> {post.historical_period.label}
                  </div>
                )}
                {post.construction_duration?.label && (
                  <div className="modal-meta-detail">
                    <span className="meta-label">Built Over:</span> {post.construction_duration.label}
                  </div>
                )}
              </div>
            )}

            {post.title && (
              <p className="modal-post-title">{post.title}</p>
            )}
            
            <PostText text={post.content} />
          </div>

          {hasMedia && (
            <div className="modal-info-footer">
              <span className="modal-media-count-badge">
                <Images size={14} />
                {activeIndex + 1} / {media.length}
              </span>
            </div>
          )}
        </div>
      </div>

      <Lightbox
        open={isLightboxOpen}
        close={() => setIsLightboxOpen(false)}
        slides={lightboxSlides}
        index={currentLightboxIndex > -1 ? currentLightboxIndex : 0}
        plugins={[Zoom]}
        zoom={{ scrollToZoom: true, maxZoomPixelRatio: 3 }}
      />
    </div>
  );
}
