import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getMediaUrl } from '../utils/media';
import GridTile from '../components/PostCard';
import TimelineSlider from '../components/TimelineSlider';
import { Search, Map as MapIcon, Grid3X3 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default leaflet icons:
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export default function Home({ context }) {
  const { 
    allPosts, filteredPosts, 
    searchQuery, setSearchQuery, 
    filterOptions,
    selectedDynasty, setSelectedDynasty,
    selectedGeo, setSelectedGeo,
    selectedSort, setSelectedSort,
    yearRange, setYearRange,
    includeUndated, setIncludeUndated,
    theme, config
  } = context;

  const { profile, map: mapConfig } = config.ui;

  const [visibleCount, setVisibleCount] = useState(config.ui.filtering.pageSize || 60);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'map'

  const navigate = useNavigate();
  const location = useLocation();

  const openPost = (post) => {
    navigate(`/post/${post.id}`, { state: { backgroundLocation: location } });
  };

  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  const heroPost = useMemo(() => {
    const candidates = allPosts.filter(p => p.confidence === 'high' && p.summary && p.media?.length > 0 && p.media[0]?.type === 'photo');
    if (candidates.length === 0) return null;
    return candidates[0];
  }, [allPosts]);

  const isFiltering = searchQuery || selectedDynasty !== 'All' || selectedGeo !== 'All' || selectedSort !== 'shuffle';

  // Map Logic
  const geoPosts = useMemo(() => {
    return filteredPosts.filter(p => p.location && p.location.lat && p.location.lng);
  }, [filteredPosts]);

  const mapCenter = [11.1271, 78.6569];
  const tileUrl = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const mapBounds = useMemo(() => {
    if (geoPosts.length === 0) return null;
    const lats = geoPosts.map(p => p.location.lat);
    const lngs = geoPosts.map(p => p.location.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    ];
  }, [geoPosts]);

  return (
    <>
      {/* ── Featured Hero ── */}
      {heroPost && !isFiltering && (
        <div className="hero-section" onClick={() => openPost(heroPost)}>
          <img 
            src={getMediaUrl(typeof heroPost.media[0] === 'string' ? heroPost.media[0] : (heroPost.media[0].publicUrl || heroPost.media[0].uri))} 
            alt="Hero Background" 
            className="hero-bg"
          />
          <div className="hero-overlay">
            <div className="hero-content">
              <span className="hero-badge">Featured Temple</span>
              <h2 className="hero-title">{heroPost.temple_name || "Unknown Temple"}</h2>
              <p className="hero-summary">{heroPost.summary}</p>
              <div className="hero-meta">
                {heroPost.dynasty && <span>{heroPost.dynasty}</span>}
                {heroPost.location && <span> • {heroPost.location.district}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isFiltering && (
        <section className="profile-section" aria-label="Profile">
          <div className="profile-avatar" aria-hidden="true">{profile.avatar}</div>
          <div className="profile-info">
            <h1 className="profile-name">{profile.name}</h1>
            <div className="profile-stats">
              <div className="profile-stat">
                <strong>{allPosts.length}</strong>
                <span>posts</span>
              </div>
              <div className="profile-stat">
                <strong>{profile.stats.followers}</strong>
                <span>followers</span>
              </div>
            </div>
            <p className="profile-bio">{profile.bio}</p>
          </div>
        </section>
      )}

      {/* ── Advanced Filter Bar ── */}
      <div className="advanced-filter-bar" style={{ marginBottom: viewMode === 'map' ? '1rem' : '1.5rem' }}>
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search keywords, temples..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="filter-dropdowns">
          <div className="filter-group view-toggle-group">
            <label>View Mode</label>
            <div className="view-toggle-btns">
              <button 
                onClick={() => setViewMode('grid')}
                className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              >
                <Grid3X3 size={16} /> Grid
              </button>
              <button 
                onClick={() => setViewMode('map')}
                className={`view-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
              >
                <MapIcon size={16} /> Map
              </button>
            </div>
          </div>

          <div className="filter-group">
            <label>Sort By</label>
            <select value={selectedSort} onChange={e => setSelectedSort(e.target.value)}>
              <option value="shuffle">Shuffle (Random)</option>
              <option value="posted_new">Posted: Newest First</option>
              <option value="posted_old">Posted: Oldest First</option>
              <option value="built_old">Age: Oldest Built First</option>
              <option value="built_new">Age: Newest Built First</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Dynasty</label>
            <select value={selectedDynasty} onChange={e => setSelectedDynasty(e.target.value)}>
              <option value="All">All Dynasties</option>
              {filterOptions.dynasties.map(d => (
                <option key={d.name} value={d.name}>{d.name.length > 30 ? d.name.substring(0, 30) + '...' : d.name}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Region</label>
            <select value={selectedGeo} onChange={e => setSelectedGeo(e.target.value)}>
              <option value="All">All Regions</option>
              {filterOptions.geos.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Dynasty Timeline Slider ── */}
        <TimelineSlider 
          yearRange={yearRange}
          setYearRange={setYearRange}
          includeUndated={includeUndated}
          setIncludeUndated={setIncludeUndated}
          config={config}
        />
      </div>

      {isFiltering && (
        <div className="active-filters-summary">
          <span>Showing {filteredPosts.length} posts matching your filters</span>
          <button 
            className="clear-filters-btn"
            onClick={() => {
              setSearchQuery('');
              setSelectedDynasty('All');
              setSelectedGeo('All');
              setSelectedSort('shuffle');
            }}
          >
            Clear All
          </button>
        </div>
      )}

      {/* ── Main Content Area (Grid or Map) ── */}
      {viewMode === 'map' ? (
        <div style={{ height: '70vh', width: '100%', maxWidth: 1200, margin: '0 auto 4rem auto', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <MapContainer 
            bounds={mapBounds || undefined}
            center={!mapBounds ? mapCenter : undefined} 
            zoom={!mapBounds ? 7 : undefined} 
            style={{ height: '100%', width: '100%', zIndex: 0 }}
          >
            <TileLayer url={tileUrl} attribution='&copy; CARTO' />
            <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
              {geoPosts.map(post => {
                const firstMedia = post.media?.[0];
                const imgSrc = firstMedia ? (typeof firstMedia === 'string' ? firstMedia : (firstMedia.publicUrl || firstMedia.uri)) : '';
                const isVid = imgSrc.endsWith('.mp4') || imgSrc.endsWith('.mov');

                return (
                  <Marker key={post.id} position={[post.location.lat, post.location.lng]}>
                    <Popup>
                      <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {imgSrc && !isVid && (
                          <img src={getMediaUrl(imgSrc)} alt="thumbnail" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 4 }} />
                        )}
                        {imgSrc && isVid && (
                          <div style={{ width: '100%', height: 130, background: '#111', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>Video</div>
                        )}
                        <div>
                          <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: '#111' }}>{post.temple_name || "Unknown"}</h3>
                          <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#666' }}>{post.location.district}</p>
                        </div>
                        <button 
                          onClick={() => openPost(post)}
                          style={{ cursor: 'pointer', background: '#d97b20', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, fontWeight: 'bold' }}>
                          View Details
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MarkerClusterGroup>
          </MapContainer>
        </div>
      ) : (
        <main className="instagram-grid-wrapper">
          <div className="instagram-grid" role="list">
            {visiblePosts.map((post, index) => (
              <GridTile
                key={post.id}
                post={post}
                index={index}
                onClick={() => openPost(post)}
              />
            ))}
          </div>

          {hasMore && (
            <div className="load-more-wrapper">
              <button className="load-more-btn" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                Load more
              </button>
            </div>
          )}
          
          {filteredPosts.length === 0 && (
            <div className="empty-state">
              <p>No posts matching your criteria.</p>
            </div>
          )}
        </main>
      )}
    </>
  );
}
