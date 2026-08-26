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
    <MemoryRouter
      initialEntries={[url]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path={path} element={children} />
      </Routes>
    </MemoryRouter>
  )
}
