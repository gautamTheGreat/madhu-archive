import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import GridTile from '../components/PostCard';
import { Search, SlidersHorizontal } from 'lucide-react';

const PAGE_SIZE = 60;

export default function Home({ context }) {
  const { 
    allPosts, filteredPosts, 
    searchQuery, setSearchQuery, 
    filterOptions,
    selectedDynasty, setSelectedDynasty,
    selectedGeo, setSelectedGeo,
    selectedSort, setSelectedSort
  } = context;

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const navigate = useNavigate();
  const location = useLocation();

  const openPost = (post) => {
    navigate(`/post/${post.id}`, { state: { backgroundLocation: location } });
  };

  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  // Featured Hero logic
  const heroPost = useMemo(() => {
    const candidates = allPosts.filter(p => p.confidence === 'high' && p.summary && p.media?.length > 0 && p.media[0]?.type === 'photo');
    if (candidates.length === 0) return null;
    return candidates[0]; // Currently picks stable first high-confidence post
  }, [allPosts]);

  // Determine if we are actively filtering the grid
  const isFiltering = searchQuery || selectedDynasty !== 'All' || selectedGeo !== 'All' || selectedSort !== 'shuffle';

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

      {/* ── Profile Section (Only on default view) ── */}
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
      <div className="advanced-filter-bar">
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

      {/* ── Active Filters Summary ── */}
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

      {/* ── Instagram Grid ── */}
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
            <button
              className="load-more-btn"
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            >
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
    </>
  );
}
