import { Field, FieldLabel } from "./ui/field";
import { useId } from "react";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

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
  const id = useId();
  return (
    <Field className="min-w-0 gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option || emptyLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
