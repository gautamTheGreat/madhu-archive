import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useNavigate, useLocation } from 'react-router-dom';

// Fix for default leaflet icons not loading properly:
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export default function MapPage({ context }) {
  const { filteredPosts, theme } = context;
  const navigate = useNavigate();
  const location = useLocation();

  // Filter posts with valid locations
  const geoPosts = useMemo(() => {
    return filteredPosts.filter(p => p.location && p.location.lat && p.location.lng);
  }, [filteredPosts]);

  const center = [11.1271, 78.6569];

  // Map Carto Tiles based on theme
  const tileUrl = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const bounds = useMemo(() => {
    if (geoPosts.length === 0) return null;
    const lats = geoPosts.map(p => p.location.lat);
    const lngs = geoPosts.map(p => p.location.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    ];
  }, [geoPosts]);

  return (
    <div style={{ height: 'calc(100vh - 64px)', width: '100%' }}>
      <MapContainer 
        bounds={bounds || undefined}
        center={!bounds ? center : undefined} 
        zoom={!bounds ? 7 : undefined} 
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          url={tileUrl}
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
          {geoPosts.map(post => {
            const firstMedia = post.media && post.media.length > 0 ? post.media[0] : null;
            const imgSrc = firstMedia ? (typeof firstMedia === 'string' ? firstMedia : (firstMedia.publicUrl || firstMedia.uri)) : '';
            const isVid = imgSrc.endsWith('.mp4') || imgSrc.endsWith('.mov');

            return (
              <Marker key={post.id} position={[post.location.lat, post.location.lng]}>
                <Popup>
                  <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {imgSrc && !isVid && (
                      <img 
                        src={imgSrc.startsWith('http') ? imgSrc : imgSrc.replace(/ /g, '%20')} 
                        alt="thumbnail" 
                        style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 4 }} 
                      />
                    )}
                    {imgSrc && isVid && (
                      <div style={{ width: '100%', height: 130, background: '#111', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>Video</div>
                    )}
                    <div>
                      <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: '#111' }}>{post.temple_name || "Unknown"}</h3>
                      <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#666' }}>{post.location.district}</p>
                    </div>
                    <button 
                      onClick={() => navigate(`/post/${post.id}`, { state: { backgroundLocation: location } })}
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
  );
}
