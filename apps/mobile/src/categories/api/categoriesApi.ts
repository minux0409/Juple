import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/** The full Category as returned by GET/POST /categories, including its list SortOrder. */
export interface Category {
  readonly id: number;
  readonly name: string;
  readonly sortOrder: number;
}

/** The Category reference embedded in Item read responses - id/name only, no SortOrder. */
export interface ItemCategory {
  readonly id: number;
  readonly name: string;
}

interface CategoriesResponse {
  readonly categories: readonly Category[];
}

export async function getCategories(
  request: AuthenticatedApiRequest,
): Promise<readonly Category[]> {
  const response = await request<CategoriesResponse>({
    method: 'GET',
    path: '/api/v1/categories',
  });

  return response.body?.categories ?? [];
}

/** POSTs a new Category; resolves with the created Category on 201 (409 on a duplicate name). */
export async function createCategory(
  request: AuthenticatedApiRequest,
  name: string,
): Promise<Category> {
  const response = await request<Category>({
    method: 'POST',
    path: '/api/v1/categories',
    body: { name },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Category body.');
  }

  return response.body;
}
