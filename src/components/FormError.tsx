import { FieldError } from "./ui/field";

export function FormError({ message }: { message: string }) {
  return <FieldError className="text-error">{message}</FieldError>;
}
