interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <label className="block w-full">
      <span className="sr-only">Search recap posts</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search title or tags"
        className="min-h-11 w-full rounded-2xl border border-stealth-700 bg-stealth-850 px-4 text-sm text-stealth-100 placeholder:text-stealth-400 focus:border-stealth-400 focus:outline-none"
      />
    </label>
  );
}
