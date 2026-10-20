import Form from "next/form";

export function SearchForm({ defaultValue = "", label = "What job do you want to try?" }) {
  return (
    <Form action="/careers" role="search" className="flex w-full max-w-xl items-end gap-2">
      {/* The label wraps the input instead of pointing at an id: Next.js keeps the previous
          page mounted, so two search forms can be in the document at once. */}
      <label className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <input
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder="nurse, UX designer, electrician…"
          autoComplete="off"
          required
          className="mt-2 w-full rounded-lg border border-line-strong bg-paper-2 px-4 py-3 text-base text-ink placeholder:text-ink-soft"
        />
      </label>
      <button
        type="submit"
        className="shrink-0 rounded-lg bg-accent px-5 py-3 font-medium text-on-accent transition-opacity hover:opacity-90"
      >
        Search
      </button>
    </Form>
  );
}
