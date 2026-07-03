// src/components/UserInfoItem.tsx
interface UserInfoItemProps {
  label: string;
  value: string | number | null | undefined;
  valueClassName?: string;
}

export default function UserInfoItem({ label, value, valueClassName }: UserInfoItemProps) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs uppercase text-fontGray mb-2 tracking-[1px]">{label}</span>
      <span className={valueClassName}>{value ?? '-'}</span>
    </div>
  );
}
