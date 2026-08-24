import type { UnfurlResourceType } from "@shared/types";

/**
 * Discriminants for the non-resource states `plane.info` can return alongside
 * a card or board payload.
 */
export enum PlaneInfoStatus {
  ReconnectRequired = "reconnect_required",
}

export type PlaneUser = {
  name: string;
  avatarUrl: string;
};

export type PlaneLabel = {
  name: string;
  color: string;
};

export type PlaneState = {
  id: string;
  name: string;
  color: string;
  group?: string;
};

/** Client-safe projection of a Plane work item, returned for issue URLs. */
export type PlaneIssueCard = {
  type: UnfurlResourceType.Issue;
  url: string;
  id: string;
  title: string;
  description: string | null;
  author: PlaneUser;
  assignees: PlaneUser[];
  labels: PlaneLabel[];
  state: PlaneState;
  createdAt: string;
};

export type PlaneBoardItem = {
  id: string;
  url: string;
  title: string;
  priority: string | null;
  labels: PlaneLabel[];
  assignees: PlaneUser[];
};

export type PlaneBoardColumn = {
  state: PlaneState;
  items: PlaneBoardItem[];
};

/**
 * Client-safe projection of a Plane project's work items grouped by state,
 * returned for project URLs. Hard-capped; `hasMore` signals truncation
 * rather than hiding it.
 */
export type PlaneBoard = {
  type: UnfurlResourceType.Project;
  url: string;
  id: string;
  name: string;
  columns: PlaneBoardColumn[];
  hasMore: boolean;
};

/** Signals that the stored Plane credential needs to be reconnected. */
export type PlaneReconnectRequired = {
  type: PlaneInfoStatus.ReconnectRequired;
};

export type PlaneInfoResponse =
  | PlaneIssueCard
  | PlaneBoard
  | PlaneReconnectRequired;

/** Client-safe projection of a Plane project, used by the project picker. */
export type PlaneProjectSummary = {
  id: string;
  name: string;
  identifier: string | null;
};
