import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Fuse from 'fuse.js';

import rawPostsData from './data/posts.json';
import config from './data/archive_config.json';
import RootLayout from './layouts/RootLayout';
import Home from './pages/Home';
import StatsPage from './pages/StatsPage';
import PostModalWrapper from './components/PostModalWrapper';

function App() {
  const [theme, setTheme] = useState('dark');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDynasty, setSelectedDynasty] = useState('All');
  const [selectedGeo, setSelectedGeo] = useState('All');
  const [selectedSort, setSelectedSort] = useState(config.ui.filtering.defaultSort || 'shuffle');

  // Year range filtering state
  const [yearRange, setYearRange] = useState([config.history.minYear, config.history.maxYear]);
  const [includeUndated, setIncludeUndated] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();

  // 1. Load robust posts array
  const allPosts = useMemo(() => {
    const dataArray = Array.isArray(rawPostsData) ? rawPostsData : (rawPostsData.posts || []);
    return dataArray.filter(p => p.content || (p.media && p.media.length > 0));
  }, []);

  // 2. Setup Fuse.js for full-text search
  const fuse = useMemo(() => {
    return new Fuse(allPosts, {
      keys: ['content', 'summary', 'temple_name', 'alternate_names', 'tags', 'location.place_name', 'location.state', 'dynasties'],
      threshold: config.ui.filtering.fuseThreshold || 0.3,
    });
  }, [allPosts]);

  // Derived unique lists for dropdowns
  const filterOptions = useMemo(() => {
    const dynastiesMap = new Map();
    const geos = new Set();
    allPosts.forEach(p => {
      if (p.dynasties) {
        p.dynasties.forEach(dynasty => {
          if (!dynastiesMap.has(dynasty)) dynastiesMap.set(dynasty, { starts: [] });
          if (p.historical_period && p.historical_period.start_year != null) {
            let sy = p.historical_period.start_year;
            if (p.historical_period.start_era === "BC" || p.historical_period.start_era === "BCE") sy = -sy;
            dynastiesMap.get(dynasty).starts.push(sy);
          }
        });
      }
      if (p.location?.state) geos.add(p.location.state);
      else if (p.location?.district) geos.add(p.location.district);
      else if (p.location?.country) geos.add(p.location.country);
    });

    const formatYear = (y) => y < 0 ? `${Math.abs(y)} BC` : `${y} CE`;

    const dynastiesArray = Array.from(dynastiesMap.entries()).map(([name, data]) => {
      const starts = data.starts;
      const min = starts.length > 0 ? Math.min(...starts) : null;
      const max = starts.length > 0 ? Math.max(...starts) : null;
      
      let labelRange = "N/A";
      if (starts.length > 0) {
        labelRange = min === max ? formatYear(min) : `${formatYear(min)} - ${formatYear(max)}`;
      }
      
      return { name, min, max, labelRange };
    }).sort((a, b) => {
      if (a.min === null && b.min !== null) return 1;
      if (b.min === null && a.min !== null) return -1;
      if (a.min !== null && b.min !== null) return a.min - b.min;
      return a.name.localeCompare(b.name);
    });

    return {
      dynasties: dynastiesArray,
      geos: Array.from(geos).sort()
    };
  }, [allPosts]);

  // 3. Derived filtered and sorted posts
  const filteredPosts = useMemo(() => {
    let result = [...allPosts];

    if (searchQuery.trim()) {
      result = fuse.search(searchQuery).map(r => r.item);
    }

    if (selectedDynasty !== 'All') {
      result = result.filter(p => p.dynasties && p.dynasties.includes(selectedDynasty));
    }

    if (selectedGeo !== 'All') {
      result = result.filter(p => 
        p.location?.state === selectedGeo || p.location?.district === selectedGeo || p.location?.country === selectedGeo
      );
    }

    // 4. Year Range Filtering
    result = result.filter(p => {
      if (p.historical_period && p.historical_period.start_year != null) {
        let sy = p.historical_period.start_year;
        if (p.historical_period.start_era === "BC" || p.historical_period.start_era === "BCE") sy = -sy;
        return sy >= yearRange[0] && sy <= yearRange[1];
      }
      return includeUndated;
    });

    // Sort Logic
    if (selectedSort === 'shuffle') {
      // Deterministic shuffle algorithm based on post IDs
      result.sort((a, b) => {
        const hashA = a.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const hashB = b.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return (hashA % 100) - (hashB % 100);
      });
    } else if (selectedSort === 'posted_new') {
      result.sort((a, b) => b.timestamp - a.timestamp);
    } else if (selectedSort === 'posted_old') {
      result.sort((a, b) => a.timestamp - b.timestamp);
    } else if (selectedSort === 'built_old' || selectedSort === 'built_new') {
      result = result.filter(p => p.historical_period?.start_year != null);
      result.sort((a, b) => {
        let yearA = a.historical_period.start_year;
        if (a.historical_period.start_era === "BC" || a.historical_period.start_era === "BCE") yearA = -yearA;
        
        let yearB = b.historical_period.start_year;
        if (b.historical_period.start_era === "BC" || b.historical_period.start_era === "BCE") yearB = -yearB;

        return selectedSort === 'built_old' ? yearA - yearB : yearB - yearA;
      });
    }

    return result;
  }, [allPosts, fuse, searchQuery, selectedDynasty, selectedGeo, selectedSort, yearRange, includeUndated]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  // Sync theme to root element for CSS variables
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Analytics: Track search queries (debounced to avoid spamming)
  useEffect(() => {
    if (window.umami && searchQuery.trim().length > 2) {
      const timer = setTimeout(() => {
        window.umami.track('search', { query: searchQuery.trim() });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [searchQuery]);

  // Analytics: Track filter usage
  useEffect(() => {
    if (window.umami && selectedDynasty !== 'All') {
      window.umami.track('filter-dynasty', { dynasty: selectedDynasty });
    }
  }, [selectedDynasty]);

  useEffect(() => {
    if (window.umami && selectedGeo !== 'All') {
      window.umami.track('filter-geo', { geo: selectedGeo });
    }
  }, [selectedGeo]);

  // Context value to pass down to Routes
  const contextValue = {
    allPosts,
    filteredPosts,
    searchQuery,
    setSearchQuery,
    filterOptions,
    selectedDynasty,
    setSelectedDynasty,
    selectedGeo,
    setSelectedGeo,
    selectedSort,
    setSelectedSort,
    yearRange,
    setYearRange,
    includeUndated,
    setIncludeUndated,
    theme,
    config
  };

  // We maintain previousLocation so the background stays intact when opening the modal
  const backgroundLocation = location.state && location.state.backgroundLocation;

  return (
    <>
      <Routes location={backgroundLocation || location}>
        <Route path="/" element={<RootLayout theme={theme} toggleTheme={toggleTheme} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />}>
          <Route index element={<Home context={contextValue} />} />
          <Route path="stats" element={<StatsPage context={contextValue} />} />
        </Route>
      </Routes>

      {/* Modal is rendered outside the main Routes layout when a backgroundLocation is present, overlaying it */}
      <Routes>
        <Route path="/post/:postId" element={<PostModalWrapper allPosts={allPosts} />} />
      </Routes>
    </>
  );
}

export default App;
