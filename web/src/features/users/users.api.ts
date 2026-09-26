// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// The user-administration endpoints (backend `modules/auth/users.controller.ts`).
import type { Role } from '@/lib/access';
import { api } from '@/lib/api-client';

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  locale: 'th' | 'en';
  status: 'ACTIVE' | 'DISABLED';
  roles: Role[];
  mfaEnabled: boolean;
  /** The account's roles demand a second factor (ADR-0008 admin). */
  mfaRequired: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface NewUser {
  email: string;
  displayName: string;
  password: string;
  locale: 'th' | 'en';
  roles: Role[];
}

export const listUsers = () => api.get<UserView[]>('/users');

export const createUser = (user: NewUser) => api.post<UserView>('/users', user);

export const grantRole = (userId: string, role: Role) =>
  api.put<UserView>(`/users/${encodeURIComponent(userId)}/roles/${role}`);

export const revokeRole = (userId: string, role: Role) =>
  api.delete<UserView>(`/users/${encodeURIComponent(userId)}/roles/${role}`);
