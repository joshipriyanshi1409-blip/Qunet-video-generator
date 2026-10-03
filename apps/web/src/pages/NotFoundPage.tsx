import { Link } from 'react-router-dom';
import { EmptyState } from '../components/StateViews';

export function NotFoundPage() {
  return (
    <EmptyState
      className="mt-10"
      title="Page not found"
      description="That screen does not exist. Head back home and pick up where you left off."
      action={
        <Link
          to="/"
          className="inline-flex h-10 items-center rounded-pill bg-peach-500 px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-peach-600"
        >
          Back to home
        </Link>
      }
    />
  );
}
