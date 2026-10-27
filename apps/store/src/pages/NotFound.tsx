import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="page container empty">
      <h1 className="display page-title">
        <span className="glitch" data-text="404">
          404
        </span>
      </h1>
      <p>Esta página no existe.</p>
      <Link className="btn btn--primary" to="/">
        Volver al inicio
      </Link>
    </div>
  );
}
