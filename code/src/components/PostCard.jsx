import { Images, Play } from 'lucide-react';
import { getMediaUrl } from '../utils/media';

export default function GridTile({ post, index, onClick }) {
  const { media, content } = post;
  const hasMedia = media && media.length > 0;

  if (!hasMedia) {
    // Text-only tile
    return (
      <div
        className="grid-tile"
        onClick={onClick}
        style={{ animationDelay: `${(index % 30) * 0.02}s`, animation: 'tileIn 0.4s ease backwards' }}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onClick()}
        aria-label="Open post"
      >
        <div className="grid-tile-text-only">
          <p className="grid-tile-text-preview">{content}</p>
        </div>
        <div className="grid-tile-overlay">
          <div className="grid-tile-overlay-stats" />
        </div>
      </div>
    );
  }

  const firstMediaItem = media[0];
  const firstMedia = typeof firstMediaItem === 'string' ? firstMediaItem : (firstMediaItem?.publicUrl || firstMediaItem?.uri || '');
  const isVideo = firstMedia.endsWith('.mp4') || firstMedia.endsWith('.mov') || firstMedia.endsWith('.webm');
  const mediaSrc = getMediaUrl(firstMedia);

  return (
    <div
      className="grid-tile"
      onClick={onClick}
      style={{ animationDelay: `${(index % 30) * 0.02}s`, animation: 'tileIn 0.4s ease backwards' }}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      aria-label="Open post"
    >
      {isVideo ? (
        <video
          className="grid-tile-media"
          src={mediaSrc}
          muted
          preload="metadata"
          playsInline
        />
      ) : (
        <img
          className="grid-tile-media"
          src={mediaSrc}
          alt=""
          loading="lazy"
        />
      )}

      {/* Multi-image indicator */}
      {media.length > 1 && !isVideo && (
        <span className="grid-tile-multi-indicator" aria-hidden="true">
          <Images size={18} />
        </span>
      )}

      {/* Video indicator */}
      {isVideo && (
        <span className="grid-tile-video-indicator" aria-hidden="true">
          <Play size={18} />
        </span>
      )}

      {/* Hover overlay */}
      <div className="grid-tile-overlay">
        <div className="grid-tile-overlay-stats">
          {media.length > 1 && (
            <span className="grid-tile-overlay-stat">
              <Images size={17} />
              {media.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
