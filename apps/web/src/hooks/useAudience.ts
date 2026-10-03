import { useMutation, useQuery } from '@tanstack/react-query';
import type { AudienceMirrorRequest, ImproveRequest } from '@creatordna/shared';
import {
  approveProject,
  fetchProject,
  improveCopy,
  mirrorContent,
} from '../lib/audience';

/**
 * Audience Mirror + the improve/approve loop.
 *
 * The mirror and improve calls are mutations, not queries: the creator presses a
 * button to spend a model call, and the result must never be served from cache
 * (that is how "improve" stops visibly improving anything).
 */

/** `retry: false` everywhere: every failure here is a state to render. */
const mutationOptions = { retry: false } as const;

/** Mirror one piece of content. */
export function useMirrorContent() {
  return useMutation({
    mutationFn: (input: AudienceMirrorRequest) => mirrorContent(input),
    ...mutationOptions,
  });
}

/** Rewrite the hook or the CTA from the mirror's feedback. */
export function useImproveCopy() {
  return useMutation({
    mutationFn: (input: Omit<ImproveRequest, 'recheck'> & { recheck?: boolean }) =>
      improveCopy(input),
    ...mutationOptions,
  });
}

/** Approve the project and enqueue the render job. */
export function useApproveProject() {
  return useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: Parameters<typeof approveProject>[1];
    }) => approveProject(projectId, payload),
    ...mutationOptions,
  });
}

/** Read a project so a reload does not lose the loop. */
export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: ['projects', projectId] as const,
    queryFn: () => fetchProject(projectId ?? ''),
    enabled: projectId !== null && projectId.length > 0,
    retry: false,
    staleTime: 0,
  });
}
