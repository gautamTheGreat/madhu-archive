import React from 'react';

export default function TimelineSlider({ yearRange, setYearRange, includeUndated, setIncludeUndated, config }) {
  const { minYear, maxYear, dynasties } = config.history;

  const handleMinChange = (e) => {
    const val = parseInt(e.target.value);
    setYearRange([Math.min(val, yearRange[1] - 1), yearRange[1]]);
  };

  const handleMaxChange = (e) => {
    const val = parseInt(e.target.value);
    setYearRange([yearRange[0], Math.max(val, yearRange[0] + 1)]);
  };

  const formatYear = (y) => {
    if (y < 0) return `${Math.abs(y)} BC`;
    return `${y} CE`;
  };

  const snapToDynasty = (range) => {
    setYearRange([range[0], range[1]]);
  };

  const majorDynasties = dynasties;

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <div className="timeline-labels">
          <span className="year-label">{formatYear(yearRange[0])}</span>
          <span className="timeline-title">Historical Timeline</span>
          <span className="year-label">{formatYear(yearRange[1])}</span>
        </div>
        
        <label className="undated-toggle">
          <input 
            type="checkbox" 
            checked={includeUndated} 
            onChange={(e) => setIncludeUndated(e.target.checked)} 
          />
          <span>Include undated posts</span>
        </label>
      </div>

      <div className="range-slider-wrapper">
        <div className="slider-track" />
        <div 
          className="slider-range-highlight" 
          style={{
            left: `${((yearRange[0] - minYear) / (maxYear - minYear)) * 100}%`,
            right: `${100 - ((yearRange[1] - minYear) / (maxYear - minYear)) * 100}%`
          }}
        />
        <input
          type="range"
          min={minYear}
          max={maxYear}
          value={yearRange[0]}
          onChange={handleMinChange}
          className="thumb thumb-left"
        />
        <input
          type="range"
          min={minYear}
          max={maxYear}
          value={yearRange[1]}
          onChange={handleMaxChange}
          className="thumb thumb-right"
        />
      </div>

      <div className="dynasty-markers">
        {majorDynasties.map((d, i) => {
          const leftPercent = ((d.range[0] - minYear) / (maxYear - minYear)) * 100;
          return (
            <button 
              key={d.name}
              className="dynasty-marker-btn"
              style={{ left: `${leftPercent}%` }}
              onClick={() => snapToDynasty(d.range)}
              title={`${d.name}: ${d.label}`}
            >
              <span className="marker-dot" />
              <span className="marker-label">
                {d.name.length > 25 ? d.name.substring(0, 25) + '...' : d.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
