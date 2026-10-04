import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../hooks/useToast';
import { useLibrary } from '../hooks/useLibrary';
import { downloadBlob, downloadStem, fetchAsBlob } from '../lib/download';
import { getShareAdapter } from '../lib/qoneqt';
import { THUMBNAILS } from '../lib/studioFixtures';

/**
 * Screen 9: Publish to Qoneqt
 */
export function PublishPage() {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get('jobId') ?? 'demo-binary-search';
  const { push } = useToast();
  const library = useLibrary();
  const [publishing, setPublishing] = useState(false);
  const [publishedPostId, setPublishedPostId] = useState<string | null>(null);

  const savedItem = library.items.find((entry) => entry.jobId === jobId);
  const displayTitle = savedItem?.title ?? 'Binary Search Made Easy ✨';
  const hashtags =
    savedItem !== undefined && savedItem.hashtags.length > 0
      ? savedItem.hashtags
      : ['#CSE', '#CodingLife', '#StudyWithMe'];

  async function handlePublish(): Promise<void> {
    setPublishing(true);
    try {
      const adapter = getShareAdapter();
      const result = await adapter.share({
        jobId,
        title: displayTitle,
        caption: savedItem?.caption ?? 'POV: You finally understand Binary Search after 3 days 😅',
        hashtags,
        mp4Url: savedItem?.mp4Url ?? '/api/v1/render-assets/demo.mp4',
      });
      if (result.ok) {
        setPublishedPostId(result.postId);
        library.update(jobId, { sharedToQoneqt: true });
        push({
          title: 'Published to Qoneqt!',
          description: `Your video is live on the Qoneqt feed (${result.postId}).`,
          tone: 'success',
        });
      } else {
        push({ title: 'Could not publish', description: result.error, tone: 'danger' });
      }
    } finally {
      setPublishing(false);
    }
  }

  function handleCopyLink(): void {
    const shareUrl = `${window.location.origin}/render/${encodeURIComponent(jobId)}/result`;
    void navigator.clipboard?.writeText(shareUrl);
    push({
      title: 'Link copied!',
      description: shareUrl,
      tone: 'success',
    });
  }

  async function handleDownload(): Promise<void> {
    const blob = await fetchAsBlob('/api/v1/render-assets/demo.mp4');
    if (blob !== null) {
      downloadBlob(blob, `${downloadStem(jobId, displayTitle)}.mp4`);
    }
    push({
      title: 'Download started',
      description: 'Saving binary-search-made-easy.mp4',
      tone: 'success',
    });
  }

  return (
    <>
      <PageHeader
        title="Ready to share on Qoneqt!"
        description="Your video is ready. Publish it to reach the Global Feed and grow your community."
      />

      <div className="mx-auto max-w-2xl space-y-5">
        {/* Video Summary Card */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
            <img
              src={THUMBNAILS.reelVerticalCover}
              alt="Binary Search Made Easy"
              className="h-24 w-36 shrink-0 rounded-xl object-cover shadow-2xs"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-body-lg font-bold text-ink-900">{displayTitle}</h2>
              <p className="mt-2 flex flex-wrap gap-2 text-caption font-semibold text-info">
                {hashtags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Primary Dark Navy Publish to Qoneqt CTA */}
        <button
          type="button"
          disabled={publishing}
          onClick={() => void handlePublish()}
          className="flex h-13 w-full items-center justify-center gap-3 rounded-pill bg-[#1a2234] px-6 text-body-lg font-bold text-white shadow-card transition-all hover:bg-[#253048] disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-pill bg-white/15 text-body font-extrabold text-white"
          >
            Q
          </span>
          <span>
            {publishing
              ? 'Publishing to Qoneqt…'
              : publishedPostId !== null
                ? 'Published to Qoneqt ✓'
                : 'Publish to Qoneqt'}
          </span>
        </button>

        {/* Secondary Action Row: Download MP4 + Copy Link */}
        <div className="grid grid-cols-2 gap-3.5">
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-body font-semibold text-ink-900 shadow-2xs transition-colors hover:bg-peach-50"
          >
            <span aria-hidden="true">⬇️</span>
            <span>Download MP4</span>
          </button>

          <button
            type="button"
            onClick={handleCopyLink}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-body font-semibold text-ink-900 shadow-2xs transition-colors hover:bg-peach-50"
          >
            <span aria-hidden="true">🔗</span>
            <span>Copy Link</span>
          </button>
        </div>

        {/* Bottom Community Banner */}
        <div className="flex items-center gap-3 rounded-2xl border border-peach-200 bg-coral-100/60 px-5 py-4 text-caption font-medium text-peach-900">
          <span aria-hidden="true" className="text-body-lg">🎉</span>
          <span>
            Published content reaches creators and learners across Qoneqt&apos;s global community.
          </span>
        </div>

        <div className="pt-2 text-center">
          <Link
            to="/library"
            className="text-caption font-semibold text-peach-700 underline underline-offset-4 hover:text-peach-800"
          >
            View in Content Library →
          </Link>
        </div>
      </div>
    </>
  );
}
