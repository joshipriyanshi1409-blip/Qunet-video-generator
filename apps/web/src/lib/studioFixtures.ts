/**
 * Studio visual fixtures, SVG data-URI illustrations, and showcase items
 * matching the 11-screen CreatorDNA Studio UI design.
 */

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

/** Devanshi Goyal creator avatar illustration */
export const DEVANSHI_AVATAR = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffd9c7"/>
      <stop offset="100%" stop-color="#ff9e78"/>
    </linearGradient>
    <linearGradient id="shirt" x1="20" y1="80" x2="100" y2="120" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2b354f"/>
      <stop offset="100%" stop-color="#1a2234"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="60" fill="url(#bg)"/>
  <path d="M26 58C26 34 40 20 60 20C80 20 94 34 94 58C94 76 88 94 82 98H38C32 94 26 76 26 58Z" fill="#1f1815"/>
  <path d="M24 120C27 95 41 84 60 84C79 84 93 95 96 120H24Z" fill="url(#shirt)"/>
  <rect x="52" y="70" width="16" height="18" rx="8" fill="#f4b998"/>
  <ellipse cx="60" cy="54" rx="22" ry="25" fill="#f7c4a5"/>
  <path d="M36 48C38 30 50 24 62 24C74 24 83 32 84 48C77 41 69 37 59 38C49 39 42 43 36 48Z" fill="#1f1815"/>
  <circle cx="51" cy="53" r="2.6" fill="#2a1b16"/>
  <circle cx="69" cy="53" r="2.6" fill="#2a1b16"/>
  <path d="M47 47C49 45.5 53 45.5 55 47" stroke="#2a1b16" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M65 47C67 45.5 71 45.5 73 47" stroke="#2a1b16" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M53 64C56 67.5 64 67.5 67 64" stroke="#cb4a25" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="45" cy="59" r="3.5" fill="#ff8f73" opacity="0.45"/>
  <circle cx="75" cy="59" r="3.5" fill="#ff8f73" opacity="0.45"/>
</svg>
`);

/** Persona avatars for Audience Mirror (Screen 5) */
export const PERSONA_AVATARS = {
  students: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="40" fill="#ffede3"/>
      <circle cx="40" cy="31" r="14" fill="#f4b895"/>
      <path d="M24 28C26 17 34 14 42 14C50 14 55 19 56 28C50 23 32 23 24 28Z" fill="#231915"/>
      <path d="M16 80C19 61 28 53 40 53C52 53 61 61 64 80H16Z" fill="#ff7f55"/>
      <circle cx="35" cy="31" r="1.8" fill="#2a1b16"/>
      <circle cx="45" cy="31" r="1.8" fill="#2a1b16"/>
      <path d="M36 37C38 39 42 39 44 37" stroke="#9c3a20" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `),
  beginners: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="40" fill="#e9f1ff"/>
      <circle cx="40" cy="31" r="14" fill="#eab392"/>
      <path d="M25 27C27 16 35 14 40 14C48 14 54 18 55 27C48 22 33 22 25 27Z" fill="#1e293b"/>
      <path d="M16 80C19 61 28 53 40 53C52 53 61 61 64 80H16Z" fill="#3b7dd8"/>
      <circle cx="35" cy="31" r="1.8" fill="#1e293b"/>
      <circle cx="45" cy="31" r="1.8" fill="#1e293b"/>
      <path d="M36 37C38 39 42 39 44 37" stroke="#1e293b" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `),
  developers: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="40" fill="#e7f6ec"/>
      <circle cx="40" cy="31" r="14" fill="#dca17e"/>
      <path d="M25 26C27 16 35 13 41 13C49 13 54 17 55 26C48 21 32 21 25 26Z" fill="#292524"/>
      <path d="M16 80C19 61 28 53 40 53C52 53 61 61 64 80H16Z" fill="#2e9e63"/>
      <rect x="30" y="28" width="8" height="5" rx="1.5" stroke="#292524" stroke-width="1.4"/>
      <rect x="42" y="28" width="8" height="5" rx="1.5" stroke="#292524" stroke-width="1.4"/>
      <path d="M36 38C38 39.5 42 39.5 44 38" stroke="#292524" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  `),
  enthusiasts: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="40" fill="#fff3da"/>
      <circle cx="40" cy="31" r="14" fill="#f1ba97"/>
      <path d="M25 27C28 16 36 14 42 14C49 14 54 18 55 27C47 22 33 22 25 27Z" fill="#451a03"/>
      <path d="M16 80C19 61 28 53 40 53C52 53 61 61 64 80H16Z" fill="#d9911f"/>
      <circle cx="35" cy="31" r="1.8" fill="#2a1b16"/>
      <circle cx="45" cy="31" r="1.8" fill="#2a1b16"/>
      <path d="M36 37C38 38.5 42 38.5 44 37" stroke="#78350f" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `),
};

/** Trend & Project Thumbnails (Screens 1, 3, 8, 9, 10) */
export const THUMBNAILS = {
  binarySearchDesk: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 210" fill="none">
      <defs>
        <linearGradient id="room" x1="0" y1="0" x2="360" y2="210" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#2c221e"/>
          <stop offset="100%" stop-color="#4b3830"/>
        </linearGradient>
        <linearGradient id="screen" x1="110" y1="45" x2="250" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1e293b"/>
        </linearGradient>
      </defs>
      <rect width="360" height="210" fill="url(#room)"/>
      <circle cx="65" cy="45" r="32" fill="#ff9e78" opacity="0.22"/>
      <circle cx="300" cy="60" r="45" fill="#ff7f55" opacity="0.18"/>
      <rect x="0" y="152" width="360" height="58" fill="#8c5a3c"/>
      <rect x="0" y="152" width="360" height="5" fill="#a8704e"/>
      <!-- Laptop -->
      <rect x="105" y="42" width="150" height="98" rx="8" fill="#334155" stroke="#64748b" stroke-width="2"/>
      <rect x="112" y="49" width="136" height="84" rx="4" fill="url(#screen)"/>
      <!-- Code lines on screen -->
      <rect x="122" y="60" width="46" height="5" rx="2.5" fill="#ff7f55"/>
      <rect x="174" y="60" width="32" height="5" rx="2.5" fill="#38bdf8"/>
      <rect x="130" y="72" width="75" height="5" rx="2.5" fill="#a7f3d0"/>
      <rect x="138" y="84" width="62" height="5" rx="2.5" fill="#fde047"/>
      <rect x="138" y="96" width="84" height="5" rx="2.5" fill="#c084fc"/>
      <rect x="130" y="108" width="48" height="5" rx="2.5" fill="#38bdf8"/>
      <path d="M88 140H272L288 154H72L88 140Z" fill="#cbd5e1"/>
      <!-- Coffee mug -->
      <rect x="288" y="118" width="28" height="34" rx="5" fill="#fff7f2"/>
      <path d="M316 125H322C325 125 327 128 327 132C327 136 325 139 322 139H316" stroke="#fff7f2" stroke-width="4"/>
    </svg>
  `),
  cseStudentLife: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 210" fill="none">
      <defs>
        <linearGradient id="bg2" x1="0" y1="0" x2="360" y2="210" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#dbeafe"/>
          <stop offset="100%" stop-color="#ffede3"/>
        </linearGradient>
      </defs>
      <rect width="360" height="210" fill="url(#bg2)"/>
      <rect x="28" y="24" width="95" height="120" rx="8" fill="#ffffff" opacity="0.75"/>
      <rect x="240" y="30" width="90" height="75" rx="8" fill="#ffffff" opacity="0.75"/>
      <!-- Phone in hand -->
      <rect x="142" y="28" width="76" height="145" rx="14" fill="#1e293b" stroke="#475569" stroke-width="3"/>
      <rect x="148" y="38" width="64" height="125" rx="9" fill="#0f172a"/>
      <circle cx="180" cy="82" r="18" fill="#ff9e78"/>
      <path d="M158 135C162 114 170 106 180 106C190 106 198 114 202 135H158Z" fill="#38bdf8"/>
      <rect x="162" y="143" width="36" height="6" rx="3" fill="#ffffff" opacity="0.8"/>
    </svg>
  `),
  studyTipsDesk: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 210" fill="none">
      <rect width="360" height="210" fill="#fef3c7"/>
      <rect x="0" y="150" width="360" height="60" fill="#d97706" opacity="0.28"/>
      <!-- Plant pot -->
      <path d="M68 115H112L105 152H75L68 115Z" fill="#ea580c"/>
      <ellipse cx="90" cy="92" rx="12" ry="26" fill="#16a34a"/>
      <ellipse cx="72" cy="100" rx="10" ry="22" transform="rotate(-25 72 100)" fill="#22c55e"/>
      <ellipse cx="108" cy="100" rx="10" ry="22" transform="rotate(25 108 100)" fill="#15803d"/>
      <!-- Open Notebook -->
      <rect x="145" y="65" width="150" height="92" rx="8" fill="#ffffff" stroke="#f59e0b" stroke-width="2"/>
      <line x1="220" y1="65" x2="220" y2="157" stroke="#fde68a" stroke-width="2"/>
      <rect x="158" y="82" width="48" height="6" rx="3" fill="#fb923c"/>
      <rect x="158" y="96" width="42" height="5" rx="2.5" fill="#94a3b8"/>
      <rect x="158" y="108" width="46" height="5" rx="2.5" fill="#94a3b8"/>
      <rect x="232" y="82" width="50" height="6" rx="3" fill="#38bdf8"/>
      <rect x="232" y="96" width="44" height="5" rx="2.5" fill="#94a3b8"/>
      <rect x="232" y="108" width="40" height="5" rx="2.5" fill="#94a3b8"/>
    </svg>
  `),
  reelVerticalCover: svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" fill="none">
      <defs>
        <linearGradient id="reelBg" x1="0" y1="0" x2="360" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#2a1b16"/>
          <stop offset="50%" stop-color="#442b21"/>
          <stop offset="100%" stop-color="#17110e"/>
        </linearGradient>
        <linearGradient id="topGlow" x1="180" y1="60" x2="180" y2="480" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ff9e78" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#17110e" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="360" height="640" fill="url(#reelBg)"/>
      <circle cx="180" cy="240" r="160" fill="url(#topGlow)"/>
      <!-- Creator silhouette / portrait -->
      <path d="M100 245C100 175 132 140 180 140C228 140 260 175 260 245C260 300 248 355 232 375H128C112 355 100 300 100 245Z" fill="#1c1412"/>
      <path d="M74 470C84 390 124 356 180 356C236 356 276 390 286 470H74Z" fill="#ff7f55"/>
      <rect x="160" y="316" width="40" height="48" rx="18" fill="#f3b897"/>
      <ellipse cx="180" cy="245" rx="54" ry="64" fill="#f7c4a5"/>
      <path d="M122 225C128 175 154 156 184 156C214 156 234 176 238 225C220 205 198 196 174 198C150 200 135 210 122 225Z" fill="#1c1412"/>
      <circle cx="158" cy="242" r="5.5" fill="#2a1b16"/>
      <circle cx="202" cy="242" r="5.5" fill="#2a1b16"/>
      <path d="M162 272C170 281 190 281 198 272" stroke="#cb4a25" stroke-width="4.5" stroke-linecap="round"/>
      <!-- Code floating badges -->
      <rect x="34" y="96" width="110" height="36" rx="10" fill="#ffffff" fill-opacity="0.12"/>
      <text x="50" y="119" fill="#ffd9c7" font-family="Inter, sans-serif" font-size="14" font-weight="600">O(log n) ⚡</text>
      <rect x="220" y="112" width="108" height="36" rx="10" fill="#ffffff" fill-opacity="0.12"/>
      <text x="234" y="135" fill="#a7f3d0" font-family="Inter, sans-serif" font-size="14" font-weight="600">mid = (L+R)/2</text>
    </svg>
  `),
};

export interface ShowcaseTrendItem {
  id: string;
  title: string;
  category: 'Trending Now' | 'For You' | 'Tech' | 'Education' | 'Lifestyle';
  viewsLabel: string;
  reactionIcon: 'heart' | 'thumb' | 'eye';
  thumbnail: string;
  relevance: number;
  format: string;
}

export const SHOWCASE_TRENDS: ShowcaseTrendItem[] = [
  {
    id: 'trend_pov_finally',
    title: 'POV: You finally understand Binary Search after 3 days 😅',
    category: 'Trending Now',
    viewsLabel: '1.24M views',
    reactionIcon: 'heart',
    thumbnail: THUMBNAILS.binarySearchDesk,
    relevance: 94,
    format: 'POV realization + visual code walkthrough',
  },
  {
    id: 'trend_cse_day_in_life',
    title: 'A day in my life as a CSE student',
    category: 'For You',
    viewsLabel: '856K views',
    reactionIcon: 'thumb',
    thumbnail: THUMBNAILS.cseStudentLife,
    relevance: 90,
    format: 'Fast-cut montage + relatable student narration',
  },
  {
    id: 'trend_study_tips',
    title: 'Study tips that actually work',
    category: 'Education',
    viewsLabel: '642K views',
    reactionIcon: 'eye',
    thumbnail: THUMBNAILS.studyTipsDesk,
    relevance: 88,
    format: '3-step actionable listicle + desk b-roll',
  },
];

export const SUGGESTED_HOOKS_SHOWCASE = [
  'POV: You finally understand Binary Search after 3 days 😅',
  'This one trick will make Binary Search click for you',
  'From confusion to confidence - Binary Search explained simply',
  "I tried Binary Search for 3 days... here's what happened",
];

export interface ShowcaseLibraryEntry {
  jobId: string;
  title: string;
  duration: string;
  statusLabel: string;
  category: 'Videos' | 'Drafts' | 'Ideas';
  views: string;
  likes: string;
  thumbnail: string;
  hashtags: string[];
  caption: string;
}

export const SHOWCASE_LIBRARY_ITEMS: ShowcaseLibraryEntry[] = [
  {
    jobId: 'demo-binary-search',
    title: 'POV: You finally understand Binary Search...',
    duration: '0:46',
    statusLabel: 'Published · 2 days ago',
    category: 'Videos',
    views: '12.4K',
    likes: '942',
    thumbnail: THUMBNAILS.binarySearchDesk,
    hashtags: ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife'],
    caption: 'POV: You finally understand Binary Search after 3 days 😅 Binary Search Made Easy ✨',
  },
  {
    jobId: 'demo-study-vlog-5',
    title: 'Study Vlog - Day 5',
    duration: '0:52',
    statusLabel: 'Published · 5 days ago',
    category: 'Videos',
    views: '8.7K',
    likes: '651',
    thumbnail: THUMBNAILS.studyTipsDesk,
    hashtags: ['#StudyWithMe', '#CSE', '#StudentsLife'],
    caption: 'Day 5 of prepping for data structures & algorithms finals!',
  },
  {
    jobId: 'demo-cse-life',
    title: 'CSE Life - A Day in College',
    duration: '0:32',
    statusLabel: 'Published · 1 week ago',
    category: 'Videos',
    views: '9.5K',
    likes: '412',
    thumbnail: THUMBNAILS.cseStudentLife,
    hashtags: ['#CSE', '#CollegeLife', '#CodingLife'],
    caption: 'Lectures, lab assignments, and debugging at 2 AM.',
  },
  {
    jobId: 'demo-coding-tips',
    title: 'Tips for Coding Trips',
    duration: '0:45',
    statusLabel: 'Draft · 2 weeks ago',
    category: 'Drafts',
    views: '0',
    likes: '0',
    thumbnail: THUMBNAILS.binarySearchDesk,
    hashtags: ['#CodingLife', '#TechTips'],
    caption: 'Drafting 3 habits that helped me solve medium LeetCode problems faster.',
  },
];
