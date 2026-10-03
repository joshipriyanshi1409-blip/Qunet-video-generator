# Content Formats

The 50 content format recipes that drive video generation in CreatorDNA Studio.

## Overview

Each format is not just a label — it is a **structured recipe** that influences
every stage of generation: hook styles, pacing, visual treatment, caption
styling, narration tone, scene structure, CTA approach, and loop strategy.

The formats are defined in `packages/shared/src/constants/contentFormats.ts`
and validated by `packages/shared/src/schemas/contentFormat.schema.ts`.

## All 50 Formats

### Storytelling (10)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 1 | `brainrot` | Brainrot | Very Fast | 15-30s |
| 2 | `pov` | POV | Moderate | 15-45s |
| 3 | `storytime` | Storytime | Moderate | 30-45s |
| 4 | `mystery` | Mystery | Slow | 25-45s |
| 5 | `dark-stories` | Dark Stories | Slow | 25-45s |
| 6 | `true-crime` | True Crime | Moderate | 30-45s |
| 7 | `reddit-stories` | Reddit Stories | Moderate | 30-45s |
| 8 | `confession-stories` | Confession Stories | Moderate | 25-45s |
| 9 | `relationship-stories` | Relationship Stories | Moderate | 25-45s |
| 10 | `aita-stories` | AITA Stories | Moderate | 25-45s |

### Lifestyle (9)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 11 | `celebrity-stories` | Celebrity Stories | Fast | 25-45s |
| 12 | `rich-lifestyle` | Rich Lifestyle | Moderate | 15-30s |
| 13 | `luxury-things` | Luxury / Expensive Things | Moderate | 20-35s |
| 14 | `success-stories` | Success Stories | Moderate | 30-45s |
| 15 | `transformation` | Transformation | Moderate | 20-40s |
| 16 | `food-content` | Food Content | Moderate | 15-35s |
| 17 | `street-food` | Street Food | Moderate | 20-35s |
| 18 | `travel` | Travel | Moderate | 20-40s |
| 19 | `hidden-places` | Hidden Places | Slow | 20-35s |

### Education & Knowledge (8)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 20 | `motivation` | Motivation | Fast | 20-40s |
| 21 | `self-improvement` | Self-Improvement | Moderate | 25-45s |
| 22 | `psychology` | Psychology | Moderate | 25-45s |
| 23 | `interesting-facts` | Interesting Facts | Fast | 15-30s |
| 24 | `did-you-know` | Did You Know | Fast | 15-30s |
| 25 | `hidden-facts` | Hidden Facts | Moderate | 20-35s |
| 26 | `history` | History | Moderate | 30-45s |
| 27 | `history-mysteries` | History Mysteries | Slow | 25-45s |
| 28 | `science-facts` | Science Facts | Moderate | 20-40s |
| 29 | `space` | Space | Slow | 25-45s |
| 30 | `tutorials` | Tutorials | Slow | 30-45s |

### Entertainment (6)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 31 | `gaming` | Gaming | Fast | 20-40s |
| 32 | `gaming-lore` | Gaming Lore | Moderate | 30-45s |
| 33 | `satisfying-videos` | Satisfying Videos | Slow | 15-30s |
| 34 | `asmr` | ASMR | Slow | 20-40s |
| 35 | `oddly-satisfying` | Oddly Satisfying | Slow | 15-25s |

### Technology (4)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 36 | `future-predictions` | Future / Predictions | Moderate | 25-40s |
| 37 | `ai-content` | AI Content | Moderate | 25-45s |
| 38 | `tech-news` | Tech News | Fast | 20-40s |
| 39 | `tech-explainers` | Tech Explainers | Moderate | 25-45s |

### Business & Finance (4)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 40 | `money-finance` | Money / Finance | Moderate | 25-45s |
| 41 | `business-stories` | Business Stories | Moderate | 30-45s |
| 42 | `startup-stories` | Startup Stories | Moderate | 30-45s |
| 43 | `how-x-makes-money` | How X Makes Money | Moderate | 25-40s |

### Lifestyle (continued)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 44 | `life-hacks` | Life Hacks | Fast | 15-30s |
| 45 | `product-discovery` | Product Discovery | Moderate | 20-35s |
| 46 | `product-testing` | Product Testing | Moderate | 25-40s |

### Wellness (2)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 47 | `fitness` | Fitness | Fast | 20-40s |
| 48 | `health-tips` | Health Tips | Moderate | 25-40s |

### Creative (2)

| # | ID | Name | Pacing | Duration |
|---|---|---|---|---|
| 49 | `ai-visual-stories` | AI Visual Stories | Moderate | 20-40s |
| 50 | `mini-documentaries` | Mini Documentaries | Moderate | 35-45s |

## Format Recipe Structure

Each format defines:

```typescript
{
  id: string;
  name: string;
  category: 'storytelling' | 'education' | 'entertainment' | 'lifestyle'
          | 'technology' | 'business' | 'creative' | 'wellness';
  description: string;

  recommendedDuration: { min: number, max: number, default: number };
  pacing: 'slow' | 'moderate' | 'fast' | 'very-fast';

  hookStyles: FormatHookStyle[];  // Which hook styles work best

  structure: SceneStructureStep[];  // The narrative arc
  // e.g., [
  //   { label: 'Hook', description: 'Opening hook', weight: 1.5 },
  //   { label: 'Context', description: 'Set the scene', weight: 2 },
  //   ...
  // ]

  visualStyle: 'cinematic' | 'minimal' | 'dynamic' | 'text-heavy'
             | 'b-roll' | 'ai-generated' | 'mixed-media'
             | 'screen-recording' | 'talking-head' | 'animation';

  captionStyle: 'word-by-word' | 'phrase' | 'full-line' | 'kinetic'
              | 'minimal' | 'bold-center' | 'subtitle';

  narrationStyle: 'conversational' | 'authoritative' | 'dramatic'
                | 'casual' | 'energetic' | 'deadpan'
                | 'storytelling' | 'educational' | 'whisper';

  sceneDuration: { min: number, max: number, default: number };

  ctaStyles: ('follow' | 'comment' | 'share' | 'save' | 'click-link'
            | 'subscribe' | 'loop' | 'series-tease' | 'soft-ask')[];

  loopStrategy: 'none' | 'soft-loop' | 'hard-loop';
  musicIntensity: number;  // 0-1
  transitions: string[];   // ['cut', 'dissolve', 'fade', ...]
  audienceTriggers: string[];
}
```

## How Formats Influence Generation

### Hook Selection

Each format specifies compatible `hookStyles`. When Hook Lab generates hooks,
it prioritizes styles that match the format.

Example: `brainrot` format → `['shock', 'curiosity', 'bold-claim']`
Example: `mystery` format → `['mystery', 'question', 'curiosity']`

### Script Structure

The format's `structure` array defines the narrative arc. The Script Agent
generates content following these steps in order, with durations weighted
by each step's `weight` value.

Example: Mini Documentary structure:
1. Hook (weight: 1.5) — compelling opening question
2. Context (weight: 2) — background and stakes
3. Evidence (weight: 2.5) — facts, data, expert input
4. Explanation (weight: 2) — what it all means
5. Visual Proof (weight: 1.5) — supporting imagery
6. Conclusion (weight: 1.5) — summary and CTA

### Scene Timing

The format's `sceneDuration` range controls how long each scene stays on screen.
Combined with the structure weights, this produces a total duration within the
format's `recommendedDuration` range.

### Visual Treatment

The `visualStyle` informs the storyboard's visual prompts:
- `cinematic` → polished, film-like visuals
- `dynamic` → fast cuts, motion, energy
- `text-heavy` → lots of on-screen text and diagrams
- `b-roll` → supplementary footage over narration
- `ai-generated` → surreal, AI-created imagery
- `screen-recording` → captured software/UI footage

### Caption Style

Different formats use different caption approaches:
- `bold-center` → Large centered words (Brainrot, Motivation)
- `subtitle` → Bottom-of-screen subtitles (Mystery, History)
- `word-by-word` → Words appear one at a time (Storytime, Reddit Stories)
- `minimal` → Few words, clean look (Space, ASMR)
- `phrase` → Short phrases (Tech Explainers, Self-Improvement)

### Music Intensity

The `musicIntensity` (0-1) controls background music volume relative to voice:
- 0.1-0.3 → Very quiet, almost ambient (ASMR, Tutorials)
- 0.3-0.5 → Moderate background (most formats)
- 0.5-0.7 → Noticeable energy (Gaming, Fitness)
- 0.7-1.0 → Driving, prominent (Brainrot, Motivation)

### CTA Approach

The format suggests appropriate calls to action:
- `follow` → "Follow for more"
- `save` → "Save this for later"
- `comment` → "What do you think? Comment below"
- `share` → "Share with someone who needs this"
- `loop` → Designed to loop seamlessly

## AI Format Recommendation

When the user selects "AI Recommended," the system scores all 50 formats:

```
Topic analysis (keywords, complexity)
    +
Creator DNA (niche, preferred format, tone)
    +
Trend context (if applicable)
    →
Top 3 format recommendations with scores and reasons
```

The scoring considers:
- **Category match** — narrative topics favor storytelling, technical topics
  favor technology/education
- **Complexity match** — longer/complex topics favor longer-duration formats
- **DNA alignment** — formats compatible with the creator's preferred style
- **Trend compatibility** — if the idea came from a trend, formats that
  preserve the trend's structure

## Adding New Formats

To add a new format recipe:

1. Add it to `CONTENT_FORMATS` in
   `packages/shared/src/constants/contentFormats.ts`
2. Ensure it validates against `contentFormatRecipeSchema`
3. Give it a unique `id`
4. Run `pnpm --filter @creatordna/shared test` to verify

The format will automatically appear in:
- The Create page format browser
- AI recommendations
- All format-related UI
