type BrandLogoProps = {
  variant?: "full" | "mark";
  className?: string;
  title?: string;
};

export default function BrandLogo({
  variant = "full",
  className,
  title = "Tandem",
}: BrandLogoProps) {
  if (variant === "mark") {
    return (
      <img
        src="/logo-mark.png/tandem%20logo%20png.png"
        alt={title}
        className={`object-contain ${className ?? ""}`}
      />
    );
  }

  return (
    <img
      src="/logo-full.png/tandem%20full%20png.png"
      alt={title}
      className={`object-contain ${className ?? ""}`}
    />
  );
}
