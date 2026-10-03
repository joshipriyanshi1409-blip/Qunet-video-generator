import {
  audienceMirrorRequestSchema,
  audienceMirrorResponseSchema,
  improveRequestSchema,
  improveResponseSchema,
  projectApprovalResponseSchema,
  projectSchema,
  renderJobPayloadSchema,
  type AudienceMirrorRequest,
  type AudienceMirrorResponse,
  type ImproveRequest,
  type ImproveResponse,
  type Project,
  type ProjectApprovalResponse,
  type RenderJobPayload,
} from '@creatordna/shared';
import { request } from './api';

/**
 * Audience Mirror + the improve/approve loop.
 *
 * Every response is validated with the shared zod schema, so a backend change
 * that breaks the contract fails loudly instead of rendering `undefined` into a
 * prediction the creator is about to act on.
 */

/**
 * `POST /audience-mirror` - judge one piece of content.
 *
 * `projectId` is passed back in on the second and later mirrors of the same
 * loop, so the backend appends to the existing project instead of starting a
 * new one.
 */
export function mirrorContent(input: AudienceMirrorRequest): Promise<AudienceMirrorResponse> {
  return request('/api/v1/audience-mirror', audienceMirrorResponseSchema, {
    method: 'POST',
    body: audienceMirrorRequestSchema.parse(input),
  });
}

/**
 * `POST /improve` - rewrite the hook or the CTA from the mirror's feedback.
 *
 * `recheck` is optional here because it defaults to true on the server; the
 * input type, not the parsed type, is what a caller should have to satisfy.
 */
export function improveCopy(
  input: Omit<ImproveRequest, 'recheck'> & { recheck?: boolean },
): Promise<ImproveResponse> {
  return request('/api/v1/improve', improveResponseSchema, {
    method: 'POST',
    body: improveRequestSchema.parse(input),
  });
}

/** `GET /projects/:projectId` - resume a loop after a reload. */
export function fetchProject(projectId: string): Promise<Project> {
  return request(`/api/v1/projects/${projectId}`, projectSchema);
}

/** `POST /projects/:projectId/approve` - approve and enqueue the render. */
export function approveProject(
  projectId: string,
  payload: RenderJobPayload,
): Promise<ProjectApprovalResponse> {
  return request(`/api/v1/projects/${projectId}/approve`, projectApprovalResponseSchema, {
    method: 'POST',
    body: renderJobPayloadSchema.parse({ ...payload, projectId }),
  });
}
