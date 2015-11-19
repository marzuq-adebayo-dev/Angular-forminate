'use strict';

var util = require('../util/util');
var _ = require('lodash');
var mongoose = require('mongoose');
var debug = {
  loadUser: require('debug')('formio:action:role#loadUser'),
  addRole: require('debug')('formio:action:role#addRole'),
  removeRole: require('debug')('formio:action:role#removeRole'),
  roleManipulation: require('debug')('formio:action:role#roleManipulation'),
  updateModel: require('debug')('formio:action:role#updateModel')
};

module.exports = function(router) {
  var Action = router.formio.Action;
  var hook = require('../util/hook')(router.formio);

  /**
   * RoleAction class.
   *   This class is used to create the Role action.
   *
   * @constructor
   */
  var RoleAction = function(data, req, res) {
    Action.call(this, data, req, res);

    // Disable the default action if the association is existing.
    req.disableDefaultAction = (data.settings.association.toString() === 'existing');
  };

  // Derive from Action.
  RoleAction.prototype = Object.create(Action.prototype);
  RoleAction.prototype.constructor = RoleAction;
  RoleAction.info = function(req, res, next) {
    next(null, {
      name: 'role',
      title: 'Role Assignment',
      description: 'Provides the Role Assignment capabilities.',
      priority: 1,
      defaults: {
        handler: ['after'],
        method: ['create']
      },
      access: {
        handler: false,
        method: false
      }
    });
  };
  RoleAction.settingsForm = function(req, res, next) {
    router.formio.resources.role.model.find(hook.alter('roleQuery', {deleted: {$eq: null}}, req))
      .sort({title: 1})
      .exec(function (err, roles) {
        if (err || !roles) {
          return res.status(400).send('Could not load the Roles.');
        }

        next(null, [
          {
            type: 'select',
            input: true,
            label: 'Resource Association',
            key: 'settings[association]',
            placeholder: 'Select the type of resource to perform role manipulation.',
            template: '<span>{{ item.title }}</span>',
            dataSrc: 'json',
            data: {
              json: JSON.stringify([
                {
                  association: 'existing',
                  title: 'Existing Resource'
                },
                {
                  association: 'new',
                  title: 'New Resource'
                }
              ])
            },
            valueProperty: 'association',
            multiple: false,
            validate: {
              required: true
            }
          },
          {
            type: 'select',
            input: true,
            label: 'Action Type',
            key: 'settings[type]',
            placeholder: 'Select whether this Action will Add or Remove the contained Role.',
            template: '<span>{{ item.title }}</span>',
            dataSrc: 'json',
            data: {
              json: JSON.stringify([
                {
                  type: 'add',
                  title: 'Add Role'
                },
                {
                  type: 'remove',
                  title: 'Remove Role'
                }
              ])
            },
            valueProperty: 'type',
            multiple: false,
            validate: {
              required: true
            }
          },
          {
            type: 'select',
            input: true,
            label: 'Role',
            key: 'settings[role]',
            placeholder: 'Select the Role that this action will Add or Remove.',
            template: '<span>{{ item.title }}</span>',
            dataSrc: 'json',
            data: {json: roles},
            valueProperty: '_id',
            multiple: false,
            validate: {
              required: true
            }
          }
        ]);
      });
  };

  /**
   * Add the roles to the user.
   *
   * @param handler
   *   TODO
   * @param method
   *   TODO
   * @param req
   *   The Express request object.
   * @param res
   *   The Express response object.
   * @param next
   *   The callback function to execute upon completion.
   */
  RoleAction.prototype.resolve = function(handler, method, req, res, next) {
    // Check the submission for the submissionId.
    if (this.settings.association !== 'existing' && this.settings.association !== 'new') {
      return next('Invalid setting `association` for the RoleAction; expecting `new` or `existing`.');
    }
    // Error if operation type is not valid.
    if (!this.settings.type || (this.settings.type !== 'add' && this.settings.type !== 'remove')) {
      return next('Invalid setting `type` for the RoleAction; expecting `add` or `remove`.');
    }
    // Error if no resource is being returned.
    if (this.settings.association === 'new' && res.hasOwnProperty('resource') && !res.resource.item && this.settings.role) {
      return next('Invalid resource was provided for RoleAction association of `new`.');
    }
    // Error if association is existing and valid data was not provided.
    if (this.settings.association === 'existing' && !(this.settings.role || req.submission.data.role)) {
      return next('Missing role for RoleAction association of `existing`. Must specify role to assign in action settings or a form component named `role`');
    }
    if (this.settings.association === 'existing' && !req.submission.data.submission) {
      return next('Missing submission for RoleAction association of `existing`. Form must have a resource field named `submission`.');
    }

    /**
     * Using the current request, load the user for role manipulations.
     *
     * @param submission
     *   The submission id.
     * @param callback
     * @returns {*}
     */
    var loadUser = function(submission, callback) {
      debug.loadUser(submission);
      router.formio.resources.submission.model.findById(submission, function(err, user) {
        if (err) {
          return next(err);
        }
        if (!user) {
          return next('No Submission was found with the given setting `submission`.');
        }

        return callback(user);
      });
    };

    // Determine the resources based on the current request.
    var resource = {};
    var role = {};
    if (this.settings.association === 'existing') {
      resource = req.submission.data.submission;
      role = this.settings.role
        ? this.settings.role
        : req.submission.data.role;
    }
    else if (this.settings.association === 'new') {
      resource = res.resource.item;
      role = this.settings.role;
    }

    var querySubmission = function(submission) {
      var url = '/form/:formId/submission/:submissionId';
      var childReq = util.createSubRequest(req);
      childReq.method = 'GET';
      childReq.skipResource = false;

      // Update the url parameters to use our updated submission.
      childReq.params = hook.alter('submissionRequestQuery', {
        formId: submission.form,
        submissionId: submission._id
      }, req);


      // Execute the resourcejs methods associated with the submissions.
      router.resourcejs[url].get.call(this, childReq, res, next);
    };

    /**
     * Attempts to save the submission. Will load the submission if not currently loaded.
     *
     * @param submission
     */
    var updateModel = function(submission, association) {
      // Try to update the submission directly.
      debug.updateModel(association);
      try {
        submission.save(function(err) {
          if (err) {
            debug.updateModel(err);
            return next(err);
          }

          // Only return the updated submission if this was a new resource.
          if (association === 'new') {
            querySubmission(submission);
          }
          else {
            next();
          }
        });
      }
      catch(e) {
        // Dealing with plain js object, load the submission object.
        router.formio.resources.submission.model.findOne({_id: submission._id}, function(err, submissionModel) {
          if (err || !submissionModel) {
            debug.updateModel(err || 'Submission not found: ' + submission._id);
            return res.status(404).send('Submission not found.');
          }

          submissionModel.roles = submission.roles;
          submissionModel.save(function(err) {
            if (err) {
              debug.updateModel(err);
              return next(err);
            }

            // Only return the updated submission if this was a new resource.
            if (association === 'new') {
              querySubmission(submission);
            }
            else {
              next();
            }
          });
        });
      }
    };

    /**
     * Add the role to the given submission object.
     *
     * @param role
     *   The RoleId in mongo.
     * @param submission
     *   The mongoose submission object to be mutated.
     * @returns {*}
     */
    var addRole = function(role, submission, association) {
      debug.addRole('Role: ' + role);
      debug.addRole('Submission: ' + JSON.stringify(submission));

      // The given role already exists in the resource.
      var compare = [];
      submission.roles.forEach(function(element) {
        if (element) {
          compare.push(element.toString());
        }
      });

      debug.addRole('Compare (' + compare.indexOf(role) + '): ' + JSON.stringify(compare));
      if (compare.indexOf(role) !== -1) {
        debug.addRole('The given role to add was found in the current list of roles already.');
        return next();
      }

      // Add and save the role to the submission.
      compare.push(role);
      compare = _.uniq(compare);
      compare = _.map(compare, function(rid) {
        return mongoose.Types.ObjectId(rid);
      });
      submission.roles = compare;

      // Update the submission model.
      debug.addRole(submission);
      updateModel(submission, association);
    };

    /**
     * Remove the role from the given submission object.
     *
     * @param role
     *   The RoleId in mongo.
     * @param submission
     *   The mongoose submission object to be mutated.
     * @returns {*}
     */
    var removeRole = function(role, submission, association) {
      debug.removeRole('Role: ' + role);
      debug.removeRole('Submission: ' + JSON.stringify(submission));

      // The given role does not exist in the resource.
      var compare = [];
      submission.roles.forEach(function(element) {
        if (element) {
          compare.push(element.toString());
        }
      });

      debug.removeRole('Compare (' + compare.indexOf(role) + '): ' + JSON.stringify(compare));
      if (compare.indexOf(role) === -1) {
        debug.removeRole('The given role to remove was not found.');
        return next();
      }

      // Remove this role from the mongoose model and save.
      compare = _.uniq(_.pull(compare, role));
      compare = _.map(compare, function(rid) {
        return mongoose.Types.ObjectId(rid);
      });
      submission.roles = compare;

      // Update the submission model.
      debug.removeRole(submission);
      updateModel(submission, association);
    };

    /**
     * Manipulate the roles based on the type.
     *
     * @param type
     *   The type of role manipulation.
     */
    var roleManipulation = function(type, association) {
      debug.roleManipulation('Type: ' + type);

      // Confirm that the given/configured role is actually accessible.
      var query = hook.alter('roleQuery', {_id: role, deleted: {$eq: null}}, req);
      debug.roleManipulation('roleManipulation: ' + JSON.stringify(query));
      router.formio.resources.role.model.findOne(query, function(err, role) {
        if (err || !role) {
          debug.roleManipulation(err || 'Role not found: ' + JSON.stringify(query));
          return res.status(400).send('The given role was not found.');
        }

        role = role.toObject()._id.toString();
        debug.roleManipulation(role);
        if (type === 'add') {
          addRole(role, resource, association);
        }
        else if (type === 'remove') {
          removeRole(role, resource, association);
        }
      });
    };

    // Flag this request to force reload the users token.
    req._refreshToken = true;

    /**
     * Resolve the action.
     */
    if (typeof resource === 'string') {
      loadUser(resource, function(user) {
        resource = user;
        roleManipulation(this.settings.type, this.settings.association);
      }.bind(this));
    }
    else {
      roleManipulation(this.settings.type, this.settings.association);
    }
  };

  // Return the RoleAction.
  return RoleAction;
};
