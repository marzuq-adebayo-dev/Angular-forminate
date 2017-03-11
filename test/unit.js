/* eslint-env mocha */
'use strict';

let assert = require('assert');
let fs = require('fs');
let docker = process.env.DOCKER;

module.exports = function(app, template, hook) {
  let Thread = require('../src/worker/Thread');

  /**
   * Unit tests for various parts of the platform.
   */
  describe('Nunjucks Rendering', function() {
    it('Should render a string with tokens', function(done) {
      new Thread(Thread.Tasks.nunjucks).start({
        render: '{{ data.firstName }} {{ data.lastName }}',
        context: {
          data: {
            firstName: 'Travis',
            lastName: 'Tidwell'
          }
        },
        filters: {
          test: function(string, param) {
            var retVal = this.env.params.form + ' : ' + string;
            if (param) {
              retVal += ' : ' + param;
            }
            return retVal;
          }
        }
      })
      .then(test => {
        assert.equal(test, 'Travis Tidwell');
        done();
      })
      .catch(done);
    });

    //it('Should timeout if someone puts bad code in the template', function(done) {
    //  new Thread(Thread.Tasks.nunjucks).start({
    //    render: '{{ callme() }}',
    //    context: {
    //      callme: function() {
    //        // Loop forever!!!!
    //        while (true) {}
    //      }
    //    }
    //  })
    //  .then(test => {
    //    // FA-857 - No email will be sent if bad code if given.
    //    assert.equal(test, null);
    //    done();
    //  })
    //  .catch(done);
    //});

    it('Should not allow them to modify parameters in the template', function(done) {
      new Thread(Thread.Tasks.nunjucks).start({
        render: '{% set form = "246" %}{{ form | test1 }} {{ data.firstName }} {{ data.lastName }}',
        context: {
          form: '123',
          data: {
            firstName: 'Travis',
            lastName: 'Tidwell'
          }
        },
        filters: {
          test1: function(string) {
            return this.env.params.form + ' : ' + string;
          }.toString()
        }
      })
      .then(test => {
        assert.equal(test, '123 : 246 Travis Tidwell');
        done();
      })
      .catch(done);
    });

    it('Should not expose private context variables.', function(done) {
      new Thread(Thread.Tasks.nunjucks).start({
        render: '{{ _private.secret }}',
        context: {
          _private: {
            secret: '5678'
          },
          form: '123',
          data: {
            firstName: 'Travis',
            lastName: 'Tidwell'
          }
        },
        filters: {
          test: function(string, param) {
            var retVal = this.env.params.form + ' : ' + string;
            if (param) {
              retVal += ' : ' + param;
            }
            return retVal;
          }
        }
      })
      .then(test => {
        assert.equal(test, '');
        done();
      })
      .catch(done);
    });

    it('Should allow filters to have access to secret variables.', function(done) {
      new Thread(Thread.Tasks.nunjucks).start({
        render: '{{ "test" | secret }}',
        context: {
          _private: {
            secret: '5678'
          },
          form: '123',
          data: {
            firstName: 'Travis',
            lastName: 'Tidwell'
          }
        },
        filters: {
          secret: function(string, param) {
            return this.env.params._private.secret;
          }.toString()
        }
      })
      .then(test => {
        assert.equal(test, '5678');
        done();
      })
      .catch(done);
    });
  });

  describe('Email Template Rendering', function() {
    if (docker) {
      return;
    }

    var formio = hook.alter('formio', app.formio);
    var email = require('../src/util/email')(formio);
    var macros = require('../src/actions/macros/macros');
    var sendMessage = function(to, from, message, content, cb) {
      console.log('sendMessage')
      var dirName = 'fixtures/email/' + message + '/';
      var submission = require('./' + dirName + 'submission.json');
      var form = require('./' + dirName + 'form.json');
      var res = {
        token: '098098098098',
        resource: {
          item: submission
        }
      };
      var req = {
        params: {
          formId: form._id
        },
        query: {
          test: 1
        },
        user: {
          _id: '123123123',
          data: {
            email: 'test@example.com',
            fullName: 'Joe Smith'
          }
        }
      };
      var messageText = macros;
      messageText += (fs.readFileSync(__dirname + '/' + dirName + 'message.html')).toString();
      var message = {
        transport: 'test',
        from: from,
        emails: to,
        sendEach: false,
        subject: 'New submission for {{ form.title }}.',
        template: '',
        message: messageText
      };

      email.getParams(res, form, submission)
      .then(params => {
        params.content = content;
        email.send(req, res, message, params, (err, response) => {
          console.log('send cb')
          if (err) {
            return cb(err);
          }

          return cb(null, response);
        });
      })
      .catch(cb)
    };

    var getProp = function(type, name, message) {
      var regExp = new RegExp('---' + name + type + ':(.*?)---');
      var matches = message.match(regExp);
      if (matches.length > 1) {
        return matches[1];
      }
      return '';
    };

    var getValue = function(name, message) {
      return getProp('Value', name, message);
    };

    var getLabel = function(name, message) {
      return getProp('Label', name, message);
    };

    it('Should render an email with all the form and submission variables.', function(done) {
      template.hooks.onEmails(1, function(emails) {
        console.log('onEmail cb')
        
        var email = emails[0];
        assert.equal(email.subject, 'New submission for Test Form.');
        assert.equal(getLabel('firstName', email.html), 'First Name');
        assert.equal(getValue('firstName', email.html), 'Joe');
        assert.equal(getLabel('lastName', email.html), 'Last Name');
        assert.equal(getValue('lastName', email.html), 'Smith');
        assert.equal(getLabel('birthdate', email.html), 'Birth Date');
        assert.equal(getValue('birthdate', email.html), '2016-06-17');
        assert.equal(getValue('vehicles', email.html), '<table border="1" style="width:100%"><tr><th style="padding: 5px 10px;">Make</th><th style="padding: 5px 10px;">Model</th><th style="padding: 5px 10px;">Year</th></tr><tr><td style="padding:5px 10px;">Chevy</td><td style="padding:5px 10px;">Suburban</td><td style="padding:5px 10px;">2014</td></tr><tr><td style="padding:5px 10px;">Chevy</td><td style="padding:5px 10px;">Tahoe</td><td style="padding:5px 10px;">2014</td></tr><tr><td style="padding:5px 10px;">Ford</td><td style="padding:5px 10px;">F150</td><td style="padding:5px 10px;">2011</td></tr></table>');
        assert.equal(getValue('house', email.html), '<table border="1" style="width:100%"><tr><th style="text-align:right;padding: 5px 10px;">Area</th><td style="width:100%;padding:5px 10px;">2500</td></tr><tr><th style="text-align:right;padding: 5px 10px;">Single Family</th><td style="width:100%;padding:5px 10px;">true</td></tr><tr><th style="text-align:right;padding: 5px 10px;">Rooms</th><td style="width:100%;padding:5px 10px;">Master, Bedroom, Full Bath, Half Bath, Kitchen, Dining, Living, Garage</td></tr><tr><th style="text-align:right;padding: 5px 10px;">Address</th><td style="width:100%;padding:5px 10px;">1234 Main, Hampton, AR 71744, USA</td></tr></table>');
        done();
      });
      sendMessage(['test@example.com'], 'me@example.com', 'test1', '', function(err, info) {
        console.log('final');
        //console.log(err);
        //console.log(info);
      });
    });

    it('Should render an email with content within the email.', function(done) {
      template.hooks.onEmails(1, function(emails) {
        var email = emails[0];
        assert.equal(email.subject, 'New submission for Test Form.');
        assert(email.html.indexOf('<div><p>Hello Joe Smith</p></div>') !== -1, 'Email content rendering failed.');
        done();
      });
      sendMessage(['test@example.com'], 'me@example.com', 'test2', '<p>Hello {{ data.firstName }} {{ data.lastName }}</p>');
    });
  });
};
