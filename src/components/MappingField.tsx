type Props = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled: boolean;
  emptyLabel?: string;
};

export function MappingField({
  label,
  value,
  options,
  onChange,
  disabled,
  emptyLabel = "Use dictionary",
}: Props) {
  const id = label.toLowerCase().replace(/\W+/g, "-");
  return (
    <div className="mapping-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="select-wrap">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option || emptyLabel}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
