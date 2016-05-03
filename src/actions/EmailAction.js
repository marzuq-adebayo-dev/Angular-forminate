'use strict';
var _ = require('lodash');
var util = require('../util/util');
var nunjucks = require('../util/nunjucks');
var request = require('request');

module.exports = function(router) {
  var Action = router.formio.Action;
  var emailer = require('../util/email')(router.formio);
  var macros = require('./macros/macros');

  /**
   * EmailAction class.
   *   This class is used to create the Email action.
   *
   * @constructor
   */
  var EmailAction = function(data, req, res) {
    Action.call(this, data, req, res);
  };

  // Derive from Action.
  EmailAction.prototype = Object.create(Action.prototype);
  EmailAction.prototype.constructor = EmailAction;
  EmailAction.info = function(req, res, next) {
    next(null, {
      name: 'email',
      title: 'Email',
      description: 'Allows you to email people on submission.',
      priority: 0,
      defaults: {
        handler: ['after'],
        method: ['create']
      }
    });
  };

  /**
   * Settings form for email action.
   *
   * @param req
   * @param res
   * @param next
   */
  EmailAction.settingsForm = function(req, res, next) {
    // Get the available transports.
    emailer.availableTransports(req, function(err, availableTransports) {
      if (err) {
        return next(err);
      }
      var settingsForm = [
        {
          type: 'select',
          input: true,
          label: 'Transport',
          key: 'settings[transport]',
          placeholder: 'Select the email transport.',
          template: '<span>{{ item.title }}</span>',
          defaultValue: 'default',
          dataSrc: 'json',
          data: {
            json: JSON.stringify(availableTransports)
          },
          valueProperty: 'transport',
          multiple: false,
          validate: {
            required: true
          }
        },
        {
          label: 'From:',
          key: 'settings[from]',
          inputType: 'text',
          defaultValue: 'no-reply@form.io',
          input: true,
          placeholder: 'Send the email from the following address',
          prefix: '',
          suffix: '',
          type: 'textfield',
          multiple: false
        },
        {
          label: 'To: Email Address',
          key: 'settings[emails]',
          inputType: 'text',
          defaultValue: '',
          input: true,
          placeholder: 'Send to the following email',
          prefix: '',
          suffix: '',
          type: 'textfield',
          multiple: true,
          validate: {
            required: true
          }
        },
        {
          label: 'Subject',
          key: 'settings[subject]',
          inputType: 'text',
          defaultValue: 'New submission for {{ form.title }}.',
          input: true,
          placeholder: 'Email subject',
          type: 'textfield',
          multiple: false
        },
        {
          label: 'Email Template URL',
          key: 'settings[template]',
          inputType: 'text',
          type: 'textfield',
          multiple: false,
          placeholder: 'Enter a URL for your external email template.'
        },
        {
          label: 'Message',
          key: 'settings[message]',
          type: 'textarea',
          defaultValue: '{{ table(form.components) }}',
          multiple: false,
          rows: 3,
          suffix: '',
          prefix: '',
          placeholder: 'Enter the message you would like to send.',
          input: true
        }
      ];

      next(null, settingsForm);
    });
  };

  /**
   * Send emails to people.
   *
   * @param req
   *   The Express request object.
   * @param res
   *   The Express response object.
   * @param cb
   *   The callback function to execute upon completion.
   */
  EmailAction.prototype.resolve = function(handler, method, req, res, next) {
    if (!this.settings.emails || this.settings.emails.length === 0) {
      return next();
    }

    // Load the form for this request.
    router.formio.cache.loadCurrentForm(req, function(err, form) {
      if (err) {
        return next(err);
      }
      if (!form) {
        return next(new Error('Form not found.'));
      }

      var params = _.cloneDeep(req.body);
      if (res && res.resource && res.resource.item) {
        params = _.assign(params, res.resource.item.toObject());
        params.id = params._id.toString();
      }

      // Flatten the resource data.
      util.eachComponent(form.components, function(component) {
        if (component.type === 'resource' && params.data[component.key]) {
          params.data[component.key + 'Obj'] = params.data[component.key];
          params.data[component.key] = nunjucks.render(component.template, {
            item: params.data[component.key]
          });
        }
      });

      // Get the parameters for the email.
      params.form = form;

      var query = {
        _id: params.owner,
        deleted: {$eq: null}
      };
      router.formio.resources.submission.model.findOne(query).exec(function(err, owner) {
        if (err) {
          // Don't worry about an error.
        }
        if (owner) {
          params.owner = owner;
        }

        var sendEmail = function(message) {
          // Prepend the macros to the message so that they can use them.
          this.settings.message = message;

          // Send the email.
          emailer.send(req, res, this.settings, params, next);
        }.bind(this);

        if (this.settings.template) {
          request(this.settings.template, function(error, response, body) {
            if (!error && response.statusCode === 200) {
              sendEmail(body);
            }
            else {
              sendEmail(macros + this.settings.message);
            }
          }.bind(this));
        }
        else {
          sendEmail(macros + this.settings.message);
        }
      }.bind(this));
    }.bind(this));
  };

  // Return the EmailAction.
  return EmailAction;
};
