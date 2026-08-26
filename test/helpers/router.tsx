import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/** Render one route at a given URL, so `useParams` resolves in tests. */
export function MemoryRoute({
  path,
  url,
  children,
}: {
  path: string
  url: string
  children: ReactNode
}): ReactNode {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={children} />
      </Routes>
    </MemoryRouter>
  )
}
