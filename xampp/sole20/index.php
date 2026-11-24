<?php
/*
 * Entrada a SOLE 20 desde XAMPP (http://localhost/sole20/).
 *
 * La tienda la ejecuta Node.js (iniciar-xampp.bat, puerto 4000) y guarda los
 * datos en el MySQL de XAMPP. Esta página solo comprueba si está encendida y
 * lleva a la tienda o al panel. El código del proyecto NO va dentro de htdocs:
 * Apache dejaría a la vista server/.env (contraseñas y secretos).
 */
$port = 4000;

// Mismo equipo o mismo nombre/IP con el que se abrió esta página (otra PC de la red)
$host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
if (!preg_match('/^[a-zA-Z0-9.\-]+$/', $host)) $host = 'localhost';
$base = "http://$host:$port";

$ctx = stream_context_create(['http' => ['timeout' => 1.5]]);
$health = @file_get_contents("http://127.0.0.1:$port/api/health", false, $ctx);
$online = $health !== false && strpos($health, '"ok":true') !== false;

if ($online && isset($_GET['ir'])) {
    header('Location: ' . $base . ($_GET['ir'] === 'panel' ? '/admin/' : '/'));
    exit;
}
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php if (!$online): ?><meta http-equiv="refresh" content="5"><?php endif; ?>
  <title>SOLE 20</title>
  <style>
    :root { --bg: #0a0a0b; --card: #141416; --line: rgba(255,255,255,.09); --text: #f4f2ee; --muted: #9b9a97; --accent: #ff2a2a; --ok: #3ddc84; --warn: #ffb020; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(ellipse at 50% 30%, #2a0d0d, var(--bg) 60%); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .card { width: min(460px, 100%); padding: 36px 32px; border: 1px solid var(--line); border-radius: 16px; background: var(--card); }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand svg { width: 34px; }
    .brand b { font: 700 30px/1 Impact, "Arial Narrow", sans-serif; letter-spacing: .02em; }
    .brand small { display: block; color: var(--accent); font: 600 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .2em; margin-top: 4px; }
    .status { display: inline-flex; align-items: center; gap: 8px; margin: 26px 0 8px; padding: 4px 12px; border-radius: 999px; border: 1px solid currentColor; font: 600 12px/1.6 ui-monospace, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; }
    .status i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .on { color: var(--ok); } .off { color: var(--warn); }
    p { color: var(--muted); margin: 8px 0 0; }
    .actions { display: grid; gap: 10px; margin-top: 26px; }
    .btn { display: block; padding: 13px 16px; border-radius: 10px; text-align: center; font-weight: 600; text-decoration: none; border: 1px solid var(--line); color: var(--text); }
    .btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn[aria-disabled="true"] { opacity: .4; pointer-events: none; }
    ol { color: var(--muted); padding-left: 20px; margin: 18px 0 0; }
    ol li { margin: 6px 0; }
    code { color: var(--text); font-family: ui-monospace, Consolas, monospace; font-size: 14px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <svg viewBox="0 0 40 24" aria-hidden="true"><path fill="#ff2a2a" d="M2 22c6 0 11-2 15-8l6 3c5 2 10 3 15 3v2H2z"/></svg>
      <div><b>SOLE 20</b><small>TIENDA DE ZAPATILLAS</small></div>
    </div>

    <?php if ($online): ?>
      <span class="status on"><i></i>Tienda encendida</span>
      <p>Funciona con la base de datos MySQL de XAMPP.</p>
    <?php else: ?>
      <span class="status off"><i></i>Tienda apagada</span>
      <p>Para encenderla:</p>
      <ol>
        <li>En el <b>XAMPP Control Panel</b>, pulsa <b>Start</b> en <b>MySQL</b>.</li>
        <li>En la carpeta del proyecto, doble clic en <code>iniciar-xampp.bat</code> y deja esa ventana abierta.</li>
      </ol>
      <p>Esta página se actualiza sola cuando la tienda esté lista.</p>
    <?php endif; ?>

    <div class="actions">
      <a class="btn btn--primary" href="?ir=tienda" aria-disabled="<?= $online ? 'false' : 'true' ?>">Abrir la tienda</a>
      <a class="btn" href="?ir=panel" aria-disabled="<?= $online ? 'false' : 'true' ?>">Panel de administración</a>
    </div>
  </main>
</body>
</html>
