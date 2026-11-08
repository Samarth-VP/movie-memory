type AvatarProps = { image: string | null; name: string };

// Shows the Google photo if there is one, otherwise a circle with the
// first letter of the name. Google doesn't always provide a photo.
export default function Avatar({ image, name }: AvatarProps) {
  if (image) {
    return (
      // Plain <img> keeps this simple: next/image would need extra config
      // to allow Google's image host. no-referrer avoids Google blocking
      // the photo when it is requested from another site.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={`${name}'s profile photo`}
        referrerPolicy="no-referrer"
        className="h-16 w-16 rounded-full object-cover"
      />
    );
  }

  return (
    <div
      aria-hidden
      className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-500/30 text-2xl font-semibold"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
