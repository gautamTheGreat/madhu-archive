import json
from pathlib import Path
from datetime import datetime

def format_year(y):
    if y is None:
        return "N/A"
    if y < 0:
        return f"{abs(y)} BC"
    return f"{y} CE"

def sync_archive_config(posts_path: Path, config_path: Path):
    """
    Reads posts.json and updates archive_config.json with the latest 
    timeline boundaries, dynasty date ranges, and post statistics.
    """
    print(f"--- Synchronizing Master Config from {posts_path.name} ---")

    if not posts_path.exists():
        print(f"Error: {posts_path} not found. Skipping config sync.")
        return

    with open(posts_path, 'r', encoding='utf-8') as f:
        posts = json.load(f)

    config = {}
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

    # 1. Update Statistics
    if 'ui' not in config: config['ui'] = {}
    if 'profile' not in config['ui']: config['ui']['profile'] = {}
    if 'stats' not in config['ui']['profile']: config['ui']['profile']['stats'] = {}
    config['ui']['profile']['stats']['posts'] = len(posts)

    # 2. Extract History and Dynasties
    min_year = 2026
    max_year = -3000
    dynasties_map = {}

    for p in posts:
        hp = p.get('historical_period')
        if hp and hp.get('start_year') is not None:
            sy = hp['start_year']
            era = hp.get('start_era', 'CE')
            if era == 'BC' or era == 'BCE':
                sy = -sy
            
            min_year = min(min_year, sy)
            max_year = max(max_year, sy)

            dyn_name = p.get('dynasty')
            if dyn_name:
                if dyn_name not in dynasties_map:
                    dynasties_map[dyn_name] = {'starts': [], 'count': 0}
                dynasties_map[dyn_name]['starts'].append(sy)
                dynasties_map[dyn_name]['count'] += 1

    # 3. Process Dynasties
    processed_dynasties = []
    for name, data in dynasties_map.items():
        d_min = min(data['starts'])
        d_max = max(data['starts'])
        label = f"{format_year(d_min)}" if d_min == d_max else f"{format_year(d_min)} - {format_year(d_max)}"
        
        processed_dynasties.append({
            'name': name,
            'range': [d_min, d_max],
            'label': label,
            'postCount': data['count'],
            'isMajor': data['count'] >= 5 # Show on main timeline track if significant content exists
        })

    # Sort by start year
    processed_dynasties.sort(key=lambda x: x['range'][0])

    config['history'] = {
        'minYear': min(min_year, -300), # Always allow Sangam era padding
        'maxYear': max(max_year, 2026),
        'dynasties': processed_dynasties
    }

    # 4. Save Updated Config
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print(f"Success! Updated config with {len(processed_dynasties)} dynasties.")
    print(f"Timeline range: {format_year(min_year)} to {format_year(max_year)}")
