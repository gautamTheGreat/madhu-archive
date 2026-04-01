import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getMediaUrl } from '../utils/media';

export default function StatsPage({ context }) {
  const { allPosts } = context;
  const navigate = useNavigate();
  const location = useLocation();

  const openPost = (post) => {
    navigate(`/post/${post.id}`, { state: { backgroundLocation: location } });
  };

  const stats = useMemo(() => {
    let totalMedia = 0;
    const dynastiesCount = {};
    const geoCount = {};
    const templesWithAge = [];

    allPosts.forEach(post => {
      // 1. Media
      if (post.media) totalMedia += post.media.length;
      
      // 2. Dynasties
      if (post.dynasty) {
        dynastiesCount[post.dynasty] = (dynastiesCount[post.dynasty] || 0) + 1;
      }
      
      // 3. Regions / Geo
      if (post.location && post.location.state) {
        geoCount[post.location.state] = (geoCount[post.location.state] || 0) + 1;
      } else if (post.location && post.location.country) {
        geoCount[post.location.country] = (geoCount[post.location.country] || 0) + 1;
      }

      // 4. Age array for oldest temples
      if (post.historical_period && post.historical_period.start_year != null) {
        let yearNum = post.historical_period.start_year;
        if (post.historical_period.start_era === "BC" || post.historical_period.start_era === "BCE") {
          yearNum = -yearNum;
        }
        templesWithAge.push({ ...post, _sortYear: yearNum });
      }
    });

    // Sort to find top
    const topDynasties = Object.entries(dynastiesCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topGeos = Object.entries(geoCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const oldestTemples = templesWithAge
      .sort((a, b) => a._sortYear - b._sortYear)
      .slice(0, 4);

    return {
      posts: allPosts.length,
      media: totalMedia,
      dynastiesTotal: Object.keys(dynastiesCount).length,
      locationsTotal: Object.keys(geoCount).length,
      topDynasties,
      topGeos,
      oldestTemples
    };
  }, [allPosts]);

  return (
    <div className="stats-container">
      <h1>Archive Statistics</h1>
      <p className="stats-subtitle">Data synthesized from {stats.posts} posts spanning {stats.dynastiesTotal} dynasties.</p>
      
      {/* Top Value Cards */}
      <div className="stats-overview-grid">
        <div className="stat-card large">
          <div className="stat-value">{stats.posts}</div>
          <div className="stat-label">Total Temples Visited</div>
        </div>
        <div className="stat-card large">
          <div className="stat-value">{stats.media}</div>
          <div className="stat-label">Photos & Videos</div>
        </div>
        <div className="stat-card large">
          <div className="stat-value">{stats.locationsTotal}</div>
          <div className="stat-label">Unique Regions</div>
        </div>
      </div>

      <div className="stats-charts-grid">
        {/* Top Dynasties Chart Box */}
        <div className="chart-box">
          <h2>Top Dynasties</h2>
          {stats.topDynasties.map(([name, count], i) => (
            <div key={name} className="chart-row">
              <div className="chart-row-info">
                <span className="chart-row-name">{name}</span>
                <span className="chart-row-count">{count}</span>
              </div>
              <div className="chart-bar-bg">
                <div className="chart-bar-fill" style={{ width: `${(count / stats.topDynasties[0][1]) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Top Regions Chart Box */}
        <div className="chart-box">
          <h2>Most Visited Regions</h2>
          {stats.topGeos.map(([name, count], i) => (
            <div key={name} className="chart-row">
              <div className="chart-row-info">
                <span className="chart-row-name">{name}</span>
                <span className="chart-row-count">{count}</span>
              </div>
              <div className="chart-bar-bg">
                <div className="chart-bar-fill" style={{ width: `${(count / stats.topGeos[0][1]) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Oldest Temples Gallery */}
      <div className="oldest-gallery-section">
        <h2>The Oldest Records</h2>
        <div className="oldest-grid">
          {stats.oldestTemples.map(post => {
            const firstMedia = post.media && post.media.length > 0 ? post.media[0] : null;
            const imgSrc = firstMedia ? (typeof firstMedia === 'string' ? firstMedia : (firstMedia.publicUrl || firstMedia.uri)) : '';
            return (
              <div 
                key={post.id} 
                onClick={() => openPost(post)}
                className="oldest-card"
              >
                {imgSrc && (
                  <img src={getMediaUrl(imgSrc)} alt="thumbnail" className="oldest-card-img" />
                )}
                <div className="oldest-card-content">
                  <div className="oldest-card-badge">
                    {post.historical_period?.label}
                  </div>
                  <h3>{post.temple_name || "Unknown"}</h3>
                  <p>{post.location?.district}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
    </div>
  );
}
