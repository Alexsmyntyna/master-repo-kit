// Shown while a page reads its files: one quiet line with a thin sweep under it (ds.css .loading).
export default function Loading() {
  return (
    <div className="loading" role="status">
      <span>Loading</span>
      <i aria-hidden />
    </div>
  );
}
