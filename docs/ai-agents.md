# AI Agents & Orchestration

How CreatorDNA Studio's AI pipeline works: specialized agents, shared context,
and the orchestrator that coordinates them.

## The principle

CreatorDNA is NOT one AI model that generates a video. It is a **creator-aware
AI production studio** where specialized AI systems collaborate through a shared
context, use different models for different jobs, select the appropriate
short-form content format, learn from Creator DNA, evaluate their own work, and
produce a publish-ready vertical video.

## Architecture

```
User Idea
    │
    ▼
┌─────────────────────────┐
│    AI ORCHESTRATOR       │  ← Central coordinator
│  (orchestrator.ts)       │
└────────┬────────────────┘
         │ loads from
         ▼
┌─────────────────┐   ┌──────────────────┐
│  Creator DNA    │   │  MODEL ROUTER     │
│  (persistent)   │   │  (modelRouter.ts) │
└─────────────────┘   └────────┬─────────┘
                               │ selects
    ┌──────────────────────────┼──────────────────────┐
    │                          │                      │
    ▼                          ▼                      ▼
┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Text  │  │  Image   │  │  Video   │  │   TTS    │
│Provider│  │ Provider │  │ Provider │  │ Provider │
└────────┘  └──────────┘  └──────────┘  └──────────┘
```

## Shared Project Context

Every stage of the pipeline reads from and writes to a single structured
`ProjectContext` object:

```typescript
interface ProjectContext {
  projectId: string;
  userId: string;

  creatorDNA: CreatorDna | null;
  topic: string;
  contentFormat: ContentFormatRecipe | null;
  trendContext: TrendContext | null;

  hooks: Hook[];
  selectedHook: Hook | null;

  script: Script | null;
  scriptEvaluation: Evaluation | null;

  storyboard: Storyboard | null;
  renderRequest: RenderCreateRequest | null;

  currentStage: OrchestratorStage;
  progress: number;
  completedStages: OrchestratorStage[];
  cache: Map<string, unknown>;
}
```

This means:
- Each agent only receives the context it needs
- Expensive results are cached and reused
- Failed stages can be retried without regenerating successful ones
- The pipeline is auditable — every stage's output is preserved

## The Orchestrator

The orchestrator (`apps/api/src/services/orchestrator.ts`) coordinates the
pipeline stages:

1. **Loading DNA** — reads the creator's persistent profile
2. **Format Selection** — AI recommends or user selects from 50 formats
3. **Hook Generation** — 5-10 hooks in different styles
4. **Script Generation** — timed script matching the format recipe
5. **Script Critic** — evaluates the script against DNA and format
6. **Storyboard** — scene-level visual plan
7. **Asset Generation** — clips, voice, music, captions (parallel)
8. **Composition** — ffmpeg assembly
9. **Quality Control** — validates the final output

The orchestrator runs independent tasks in parallel where possible (e.g.,
generating clips for different scenes simultaneously) and retries failed
stages without touching successful ones.

## Model Router

The Model Router (`apps/api/src/services/ai/modelRouter.ts`) abstracts AI
providers behind a unified interface:

```typescript
interface ModelRouter {
  getProviders(): ProviderInfo[];
  getCapabilityStatus(capability): ProviderStatus;
  selectModel(criteria): ProviderInfo | null;
  getTextProvider(preferred?): TextProvider | null;
  getImageProvider(preferred?): ImageProvider | null;
  getVideoProvider(preferred?): VideoProvider | null;
  getTtsProvider(preferred?): TtsProvider | null;
  getMusicProvider(preferred?): MusicProvider | null;
}
```

### Supported Capabilities

| Capability | Description | Current Provider |
|---|---|---|
| `TEXT_GENERATION` | Scripts, hooks, analysis | Gemini REST API |
| `REASONING` | Script critic, format selection | Same as text |
| `IMAGE_GENERATION` | Scene visuals | Not configured (mock frames) |
| `VIDEO_GENERATION` | Video clips | Veo (when configured) |
| `TTS` | Voice-over | Gemini TTS (when configured) |
| `STT` | Caption alignment | Gemini Transcribe (when configured) |
| `MUSIC_GENERATION` | Background music | Lyria (when configured) |
| `EMBEDDINGS` | Search/relevance | Not yet implemented |
| `MODERATION` | Content safety | Not yet implemented |
| `VISION` | Image analysis | Not yet implemented |

### Provider Selection

The router selects providers based on criteria:

```typescript
router.selectModel({
  capability: 'TEXT_GENERATION',
  priority: 'cost', // 'cost' | 'quality' | 'speed' | 'balanced'
  preferredProvider: 'gemini-2.0-flash', // optional
});
```

Priority modes:
- **cost** — cheapest available provider
- **quality** — most expensive (assumed best)
- **speed** — fastest response
- **balanced** — middle-ground (default)

### Adding a New Provider

Create a provider adapter that implements the appropriate interface:

```typescript
// Example: Adding an OpenAI text provider
class OpenAITextProvider implements TextProvider {
  readonly id = 'openai-gpt4';
  readonly name = 'OpenAI GPT-4';
  readonly capabilities = ['TEXT_GENERATION', 'REASONING'] as const;
  readonly costTier = 3;
  readonly speedTier = 2;

  supports(capability) { return this.capabilities.includes(capability); }
  getStatus() { return this.apiKey ? 'available' : 'not_configured'; }
  async healthCheck() { /* ... */ }
  async generateText(request) { /* ... */ }
}
```

Then register it with the router:

```typescript
const router = createModelRouter({
  logger,
  textProviders: [geminiProvider, openaiProvider],
});
```

## 50 Content Format Recipes

Every format is a structured recipe that influences generation:

```typescript
interface ContentFormatRecipe {
  id: string;
  name: string;
  category: ContentFormatCategory;
  description: string;
  recommendedDuration: { min: number; max: number; default: number };
  pacing: 'slow' | 'moderate' | 'fast' | 'very-fast';
  hookStyles: FormatHookStyle[];
  structure: SceneStructureStep[];  // The narrative arc
  visualStyle: VisualStyle;
  captionStyle: CaptionStyle;
  narrationStyle: NarrationStyle;
  sceneDuration: { min: number; max: number; default: number };
  ctaStyles: CtaStyle[];
  loopStrategy: 'none' | 'soft-loop' | 'hard-loop';
  musicIntensity: number;  // 0-1
  transitions: string[];
  audienceTriggers: string[];
}
```

### Format Categories

| Category | Formats | Examples |
|---|---|---|
| Storytelling | 10 | Storytime, Mystery, True Crime, Reddit Stories |
| Education | 8 | Tech Explainers, Science Facts, Tutorials |
| Entertainment | 6 | Brainrot, Gaming, Satisfying Videos |
| Lifestyle | 9 | Rich Lifestyle, Food Content, Travel |
| Technology | 4 | AI Content, Tech News, Future Predictions |
| Business | 4 | Business Stories, How X Makes Money |
| Creative | 2 | AI Visual Stories, Mini Documentaries |
| Wellness | 2 | Fitness, Health Tips |

### How Formats Influence Generation

When a format is selected, it affects:

1. **Hook generation** — only compatible hook styles are offered
2. **Script structure** — the narrative follows the format's scene steps
3. **Pacing** — scene durations match the format's timing
4. **Visual style** — storyboard prompts use the format's visual approach
5. **Caption style** — captions use the format's preferred style
6. **Music intensity** — music bed volume matches the format
7. **CTA approach** — call to action matches the format's style

Example: selecting "Mini Documentary" produces:
- A hook that poses a compelling question
- Scenes structured as Hook → Context → Evidence → Explanation → Conclusion
- Cinematic visual style with b-roll
- Subtitle-style captions
- Moderate pacing with 5-12 second scenes
- A "follow" or "save" CTA

## Pipeline Stages in Detail

### 1. Creator DNA Loading

```
User → DNA Repository → CreatorDna | null
```

The DNA is loaded once and injected into every subsequent AI call. If no DNA
exists, the system generates without personal style (notified to the user).

### 2. Format Selection

```
Topic + DNA → Format Scoring → Top 3 Recommendations
```

The format selector analyzes the topic, DNA niche, and format history to score
all 50 formats. The creator can accept the AI recommendation or browse all
formats manually.

### 3. Hook Generation

```
Topic + Format + DNA → Hook Lab → 5-10 hooks with evaluations
```

Hooks are generated in styles compatible with the selected format. Each hook
includes a "why it works" explanation.

### 4. Script Generation

```
Topic + Format + Hook + DNA → Script Agent → Timed script
```

The script follows the format's structure steps and is timed to match the
format's recommended duration.

### 5. Script Critic

```
Script + Format + DNA → Critic → PASS or REVISION_REQUIRED
```

A separate evaluation stage checks:
- Hook strength
- Pacing compliance
- DNA fit
- Format compliance
- Duration fit

If revision is needed, structured feedback goes back to the Script Agent.
Maximum 3 revision loops to prevent infinite generation.

### 6. Storyboard

```
Script + Format + DNA → Storyboard Agent → Scene-level visual plan
```

Each scene gets:
- Duration
- Narration
- Visual prompt
- On-screen text
- Caption style

### 7. Asset Generation (parallel)

```
Storyboard → ┬─ Clip Generator (per scene)
             ├─ Voice Generator (TTS)
             ├─ Music Generator
             └─ Caption Aligner
```

Scene clips can be generated in parallel. Voice, music, and captions are
independent and also parallel.

### 8. Composition

```
Clips + Voice + Music + Captions → FFmpeg → 9:16 MP4
```

### 9. Quality Control

```
MP4 + metadata → QC checks → Pass / Fail
```

Technical checks:
- MP4 exists and is playable
- Correct codec and resolution (9:16)
- Duration within range
- Audio present
- No black frames
- Captions present

AI checks:
- Script/video alignment
- DNA alignment
- Format compliance

## Retry & Resume

The pipeline is designed for **incremental retry**:

```
If scene 4 video generation fails:
  → Retry scene 4 ONLY
  → Scenes 1-3 are kept

If captions fail:
  → Retry captions ONLY
  → Video is not regenerated

If compose fails:
  → Retry compose ONLY
  → All assets (clips, voice, music) are reused
```

This is implemented through the `alreadyDone` check in each stage runner
and the asset merge logic in the pipeline.

## Cost Control

The system uses different model tiers for different tasks:

| Task | Tier | Rationale |
|---|---|---|
| Format selection | Cheap/fast | Classification, not creative |
| Hook generation | Medium | Creative but bounded |
| Script generation | Strong | Core creative output |
| Script critic | Medium | Evaluation, not generation |
| Storyboard | Strong | Visual planning |
| Video clips | Expensive | Only approved scenes |
| Voice-over | Medium | Per-scene generation |
| Music | Medium | One generation per video |

Expensive results are cached by content hash so identical requests reuse
existing outputs.
