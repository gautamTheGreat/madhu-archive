import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import GridTile from '../components/PostCard';
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

const PAGE_SIZE = 60;

export default function Home({ context }) {
  const { 
    allPosts, filteredPosts, 
    searchQuery, setSearchQuery, 
    filterOptions,
    selectedDynasty, setSelectedDynasty,
    selectedGeo, setSelectedGeo,
    selectedSort, setSelectedSort,
    theme
  } = context;

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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
            src={typeof heroPost.media[0] === 'string' ? heroPost.media[0] : (heroPost.media[0].publicUrl || heroPost.media[0].uri)} 
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
          <div className="profile-avatar" aria-hidden="true">M</div>
          <div className="profile-info">
            <h1 className="profile-name">Madhu Jagdhish</h1>
            <div className="profile-stats">
              <div className="profile-stat">
                <strong>{allPosts.length}</strong>
                <span>posts</span>
              </div>
              <div className="profile-stat">
                <strong>10k+</strong>
                <span>followers</span>
              </div>
            </div>
            <p className="profile-bio">
              Sculpture Enthusiast · Documenting ancient temple art, inscriptions & architecture across South & Southeast Asia.
            </p>
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
          <div className="filter-group view-toggle-group" style={{ flex: '0 0 auto', borderRight: '1px solid var(--border)', paddingRight: '1rem' }}>
            <label>View Mode</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                onClick={() => setViewMode('grid')}
                className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1rem', borderRadius: 6, border: '1px solid var(--border)', background: viewMode === 'grid' ? 'var(--text)' : 'var(--surface)', color: viewMode === 'grid' ? 'var(--bg)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
              >
                <Grid3X3 size={16} /> Grid
              </button>
              <button 
                onClick={() => setViewMode('map')}
                className={`view-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1rem', borderRadius: 6, border: '1px solid var(--border)', background: viewMode === 'map' ? 'var(--text)' : 'var(--surface)', color: viewMode === 'map' ? 'var(--bg)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
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
            <label>Dynasty / Era</label>
            <select value={selectedDynasty} onChange={e => setSelectedDynasty(e.target.value)}>
              <option value="All">All Dynasties</option>
              {filterOptions.dynasties.map(d => (
                <option key={d} value={d}>{d}</option>
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
                          <img src={imgSrc.startsWith('http') ? imgSrc : imgSrc.replace(/ /g, '%20')} alt="thumbnail" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 4 }} />
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
