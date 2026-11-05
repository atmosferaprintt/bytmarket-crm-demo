import { PageHeader } from '../../shell/PageHeader';
import { useDB } from '../../data/store';
import { CourierBoard, CourierSummary, RouteButton } from './CourierBoard';
import { clockOf } from './lib';
import './delivery.css';

/** Рабочий стол: курьер. Телефон в первую очередь — мои заявки на сегодня по маршруту. */
export default function Home() {
  const db = useDB();
  const c = clockOf(db);
  return (
    <div className="dl-phone">
      <PageHeader section="overview" actions={<RouteButton day={c.today} />} />
      <CourierSummary day={c.today} />
      <CourierBoard day={c.today} />
    </div>
  );
}
