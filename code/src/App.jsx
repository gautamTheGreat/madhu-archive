import React, { useState, useEffect, useCallback } from 'react';
import postsData from './data/posts.json';
import GridTile from './components/PostCard';
import PostModal from './components/PostModal';
import { Grid3X3 } from 'lucide-react';
import './index.css';

const PAGE_SIZE = 60;

function App() {
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const valid = postsData.filter(p => p.content || (p.media && p.media.length > 0));
    setPosts(valid);
  }, []);

  const openPost = useCallback((post) => setSelectedPost(post), []);
  const closePost = useCallback(() => setSelectedPost(null), []);

  const visiblePosts = posts.slice(0, visibleCount);
  const hasMore = visibleCount < posts.length;

  return (
    <>
      {/* ── Navigation ── */}
      <nav className="app-nav">
        <a className="nav-brand" href="/" aria-label="Home">
          <div className="nav-brand-icon">M</div>
          <div>
            <div className="nav-brand-name">Madhu Jagdhish</div>
            <div className="nav-brand-sub">Sculpture Enthusiast</div>
          </div>
        </a>
        <span className="nav-count">{posts.length} posts</span>
      </nav>

      {/* ── Profile Section ── */}
      <section className="profile-section" aria-label="Profile">
        <div className="profile-avatar" aria-hidden="true">M</div>
        <div className="profile-info">
          <h1 className="profile-name">Madhu Jagdhish</h1>
          <div className="profile-stats">
            <div className="profile-stat">
              <strong>{posts.length}</strong>
              <span>posts</span>
            </div>
            <div className="profile-stat">
              <strong>10k+</strong>
              <span>followers</span>
            </div>
          </div>
          <p className="profile-bio">
            Sculpture Enthusiast · Documenting ancient temple art, inscriptions & architecture across South &amp; Southeast Asia.
          </p>
        </div>
      </section>

      {/* ── Tabs ── */}
      <div className="grid-tabs" role="tablist">
        <button className="grid-tab active" role="tab" aria-selected="true">
          <Grid3X3 size={13} />
          Posts
        </button>
      </div>

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
      </main>

      {/* ── Post Modal ── */}
      {selectedPost && (
        <PostModal post={selectedPost} onClose={closePost} />
      )}
    </>
  );
}

export default App;
