const AppError = require('../utils/AppError');

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    params: req.params,
    query: req.query
  });

  if (!result.success) {
    return next(new AppError('Validation failed', 422, result.error.errors));
  }

  // Propagate parsed/coerced values (for example z.coerce.date()).
  if (result.data.body !== undefined) req.body = result.data.body;
  if (result.data.params !== undefined) req.params = result.data.params;
  if (result.data.query !== undefined) req.query = result.data.query;

  req.validated = result.data;
  return next();
};

module.exports = validate;
