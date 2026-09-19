export function ErrorState({
  title = 'Something went wrong',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-16 text-center"
    >
      <p className="text-lg font-semibold text-red-900">{title}</p>
      {description ? <p className="max-w-md text-sm text-red-700">{description}</p> : null}
    </div>
  );
}
