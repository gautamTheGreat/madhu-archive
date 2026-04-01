import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Moon, Sun, Search, Grid3X3, Map as MapIcon, BarChart2 } from 'lucide-react';

export default function RootLayout({ theme, toggleTheme, searchQuery, setSearchQuery }) {
  return (
    <div className={`app-container ${theme}`}>
      <nav className="app-nav">
        <NavLink className="nav-brand" to="/">
          <div className="nav-brand-icon">M</div>
          <div>
            <div className="nav-brand-name">Madhu Jagdhish</div>
            <div className="nav-brand-sub">Sculpture Archive</div>
          </div>
        </NavLink>

        <div className="nav-center">
          {/* Search moved to Home page explicitly */}
        </div>

        <div className="nav-right">
          <div className="nav-links">
            <NavLink to="/" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}>
              <Grid3X3 size={18} /> <span className="hide-mobile">Grid</span>
            </NavLink>
            <NavLink to="/map" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}>
              <MapIcon size={18} /> <span className="hide-mobile">Map</span>
            </NavLink>
            <NavLink to="/stats" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}>
              <BarChart2 size={18} /> <span className="hide-mobile">Stats</span>
            </NavLink>
          </div>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </nav>

      <div className="app-content">
        <Outlet />
      </div>
    </div>
  );
}
