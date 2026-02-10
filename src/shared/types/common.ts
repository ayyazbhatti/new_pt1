export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export interface SortParams {
  field: string
  direction: 'asc' | 'desc'
}

export interface FilterParams {
  [key: string]: unknown
}

