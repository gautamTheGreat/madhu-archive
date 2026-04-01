import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

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
    <div className="stats-container" style={{ maxWidth: 1000, margin: '3rem auto', padding: '0 2rem' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: 'var(--text)', fontWeight: 700 }}>Archive Statistics</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '3rem', fontSize: '1.1rem' }}>Data synthesized from {stats.posts} posts spanning {stats.dynastiesTotal} dynasties.</p>
      
      {/* Top Value Cards */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <div style={{ background: 'var(--surface2)', padding: '2rem', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{stats.posts}</div>
          <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.85rem', marginTop: '1rem' }}>Total Temples Visited</div>
        </div>
        <div style={{ background: 'var(--surface2)', padding: '2rem', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{stats.media}</div>
          <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.85rem', marginTop: '1rem' }}>Photos & Videos</div>
        </div>
        <div style={{ background: 'var(--surface2)', padding: '2rem', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{stats.locationsTotal}</div>
          <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.85rem', marginTop: '1rem' }}>Unique Regions</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
        {/* Top Dynasties Chart Box */}
        <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: 12, border: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', color: 'var(--text)' }}>Top Dynasties</h2>
          {stats.topDynasties.map(([name, count], i) => (
            <div key={name} style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{count}</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'var(--surface2)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${(count / stats.topDynasties[0][1]) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: '4px' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Top Regions Chart Box */}
        <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: 12, border: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', color: 'var(--text)' }}>Most Visited Regions</h2>
          {stats.topGeos.map(([name, count], i) => (
            <div key={name} style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{count}</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'var(--surface2)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${(count / stats.topGeos[0][1]) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: '4px' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Oldest Temples Gallery */}
      <div>
        <h2 style={{ fontSize: '1.75rem', marginBottom: '1.5rem', color: 'var(--text)' }}>The Oldest Records</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
          {stats.oldestTemples.map(post => {
            const firstMedia = post.media && post.media.length > 0 ? post.media[0] : null;
            const imgSrc = firstMedia ? (typeof firstMedia === 'string' ? firstMedia : (firstMedia.publicUrl || firstMedia.uri)) : '';
            return (
              <div 
                key={post.id} 
                onClick={() => openPost(post)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-4px)' } }}
              >
                {imgSrc && (
                  <img src={imgSrc.startsWith('http') ? imgSrc : imgSrc.replace(/ /g, '%20')} alt="thumbnail" style={{ width: '100%', height: 180, objectFit: 'cover' }} />
                )}
                <div style={{ padding: '1.25rem' }}>
                  <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {post.historical_period?.label}
                  </div>
                  <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', color: 'var(--text)', lineHeight: 1.3 }}>{post.temple_name || "Unknown"}</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{post.location?.district}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
    </div>
  );
}
