interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <label className="block w-full">
      <span className="sr-only">Search updates</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search title or tags"
        className="w-full rounded-2xl border border-stealth-700 bg-stealth-850 px-4 py-2.5 text-sm text-stealth-100 placeholder:text-stealth-500 focus:border-stealth-500 focus:outline-none"
      />
    </label>
  );
}
