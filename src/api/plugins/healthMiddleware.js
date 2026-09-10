function healthMiddleware(readiness) {
  return async (ctx, next) => {
    if (!['GET', 'HEAD'].includes(ctx.method) || !['/livez', '/readyz'].includes(ctx.path)) return next();
    ctx.set('Cache-Control', 'no-store');
    if (ctx.path === '/livez') {
      ctx.body = { alive: true };
      return undefined;
    }
    const result = await readiness();
    ctx.status = result.ready ? 200 : 503;
    ctx.body = result;
    return undefined;
  };
}

module.exports = healthMiddleware;
