import Link from "next/link";

/** Generic 404. */
export default function NotFound() {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link href="/" className="mt-3 inline-block text-sm underline">
        Back to SignalDesk
      </Link>
    </div>
  );
}
