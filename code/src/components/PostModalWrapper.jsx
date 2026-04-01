import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PostModal from './PostModal';

export default function PostModalWrapper({ allPosts }) {
  const { postId } = useParams();
  const navigate = useNavigate();

  // Find the post
  const post = allPosts.find(p => p.id === postId);

  const handleClose = () => {
    // Navigate back. If we have a background state, we can go back 1 step, or just navigate to '/'
    navigate(-1);
  };

  if (!post) {
    return (
      <div className="modal-overlay" onClick={handleClose}>
        <div style={{ color: 'white', margin: 'auto' }}>Post not found.</div>
      </div>
    );
  }

  return <PostModal post={post} onClose={handleClose} />;
}
