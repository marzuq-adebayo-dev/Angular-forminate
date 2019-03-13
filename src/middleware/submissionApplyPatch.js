'use strict';
const jsonPatch = require('fast-json-patch');
const _ = require('lodash');

module.exports = router => (req, res, next) => {
  if (req.method !== 'PATCH') {
    return next();
  }

  const childReq = router.formio.util.createSubRequest(req);
  if (!childReq) {
    return res.headersSent ? next() : res.status(400).json('Too many recursive requests.');
  }
  childReq.method = 'GET';

  const childRes = router.formio.util.createSubResponse((err) => {
    if (childRes.statusCode > 299) {
      return res.headersSent ? next() : res.status(childRes.statusCode).json(err);
    }
  });

  router.resourcejs[req.route.path]['get'](childReq, childRes, function(err) {
    if (err) {
      return res.status(400).send(err);
    }

    const submission = _.get(childReq, 'resource.item', false);
    // No submission exists.
    if (!submission) {
      return res.sendStatus(404);
    }

    const patch = req.body;

    try {
      req.body = jsonPatch.applyPatch(submission, patch, true).newDocument;

      return next();
    }
    catch (err) {
      res.status(400).send(err);
    }
  });
};
