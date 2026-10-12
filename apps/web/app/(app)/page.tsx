import { HomeView } from './HomeView';

/** "/": Home (오늘 저장한 링크) once signed in; AppRoot shows the landing page instead while signed out. */
export default function HomePage() {
  return <HomeView />;
}
