import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Images, Play } from 'lucide-react';

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
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const currentSrc = media[activeIndex];
  const isVideo = currentSrc && (currentSrc.endsWith('.mp4') || currentSrc.endsWith('.mov') || currentSrc.endsWith('.webm'));

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
                <img
                  key={currentSrc}
                  className="modal-main-media"
                  src={currentSrc.startsWith('http') ? currentSrc : currentSrc.replace(/ /g, '%20')}
                  alt={`Photo ${activeIndex + 1} of ${media.length}`}
                />
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
                    {media.map((src, i) => {
                      const isVid = src.endsWith('.mp4') || src.endsWith('.mov') || src.endsWith('.webm');
                      return isVid ? (
                        <div
                          key={i}
                          className={`modal-thumb${activeIndex === i ? ' active' : ''}`}
                          onClick={() => setActiveIndex(i)}
                          style={{ background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          <Play size={16} color="white" />
                        </div>
                      ) : (
                        <img
                          key={i}
                          className={`modal-thumb${activeIndex === i ? ' active' : ''}`}
                          src={src.startsWith('http') ? src : src.replace(/ /g, '%20')}
                          alt={`Thumb ${i + 1}`}
                          onClick={() => setActiveIndex(i)}
                          loading="lazy"
                        />
                      );
                    })}
                  </div>

                  {/* Dot counter */}
                  {media.length <= 10 && (
                    <div className="modal-media-counter">
                      {media.map((_, i) => (
                        <div
                          key={i}
                          className={`modal-media-dot${activeIndex === i ? ' active' : ''}`}
                          onClick={() => setActiveIndex(i)}
                        />
                      ))}
                    </div>
                  )}
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
    </div>
  );
}
