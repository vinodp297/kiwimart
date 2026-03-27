// Prevent the public layout (and its pages) from being statically cached.
// The NavBar reads session state — a cached snapshot could show logged-in
// controls to a user who has since signed out.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
