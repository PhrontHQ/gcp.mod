const RawDataService = require("mod/data/service/raw-data-service").RawDataService,
    Montage = require('mod/core/core').Montage,
    //SyntaxInOrderIterator = (require)("mod/core/frb/syntax-iterator").SyntaxInOrderIterator,
    DataOperation = require("mod/data/service/data-operation").DataOperation,
    os = require('os'),
    path = require('path'),
    homeDirectory = os.homedir();
    

var SecretManagerServiceClient;

    //Causes issues
    // secretObjectDescriptor = (require) ("app-infrastructure-data-mod/data/main.mod/model/secret.mjson").montageObject;

    /*
        https://cloud.google.com/nodejs/docs/reference/secret-manager/latest
        https://github.com/googleapis/google-cloud-node/blob/main/packages/google-cloud-secretmanager/package.json
        https://www.npmjs.com/package/@google-cloud/secret-manager
    */

    /*
        Set up Application Default Credentials
        https://cloud.google.com/docs/authentication/provide-credentials-adc
    */

    /*
        Quickstart
        https://cloud.google.com/secret-manager/docs/samples/secretmanager-quickstart?hl=en
    */


/**
* TODO: Create a shared CloudServiceRawDataService that would become the super class of aws.mod's SecretManagerDataService and this one
*
*
* @class
* @extends RawDataService
*/
exports.SecretManagerDataService = class SecretManagerDataService extends RawDataService {/** @lends SecretManagerDataService */


    /***************************************************************************
     * Initializing
     */

    constructor() {
        super();

        //var mainService = DataService.mainService;
        //this.addEventListener(DataOperation.Type.ReadOperation,this,false);
        /*
            There's somethig fragile that needs to be solved here. If we listen on this, expecting that an event whose target is secretObjectDescriptorm, which we manage, is going to bubble to us. The problem is that it bubbles from Secret to DataObject first, but DataObject isn't handled by SecretManagerDataService, and so it bubbles through something else that manages directly DataObject. So that logic has to be adapted.

            There's also a dependency graph issue if we require secretObjectDescriptor directly, leaving it commmented above to remind of it.
        */
        //secretObjectDescriptor.addEventListener(DataOperation.Type.ReadOperation,this,false);
        var self = this;
        this._childServiceTypes.addRangeChangeListener(function (plus, minus) {
            for (var i=0, countI = plus.length, iObjectDescriptor; (i < countI); i++) {
                iObjectDescriptor = plus[i];
                if(iObjectDescriptor.name === "Secret") {
                    iObjectDescriptor.addEventListener(DataOperation.Type.ReadOperation,self,false);
                }
            }
        });

        return this;
    }

    static {

        Montage.defineProperties(this.prototype, {
            apiVersion: {
                value: "FROM AWS, NECESSARY FOR GCP?"
            }
        });
    }

    /*
        https://cloud.google.com/docs/authentication/client-libraries
    */
    instantiateRawClientWithOptions(rawClientOptions) {
        return new SecretManagerServiceClient(rawClientOptions/*??*/);
    }

    get rawClientPromises() {
        var promises = super.rawClientPromises;

        /*
            This lazy load allows to reduce cold-start time, but to kick-start load of code in the phase that's not billed, at least on AWS
        */

        promises.push(
            // require.async("@aws-sdk/client-secrets-manager/dist-cjs/SecretsManagerClient").then(function(exports) { SecretsManagerClient = exports.SecretsManagerClient})
            require.async("@google-cloud/secret-manager").then((exports) => {
                SecretManagerServiceClient = exports.v1.SecretManagerServiceClient;
                this._rawClient = new SecretManagerServiceClient( {
                    keyFilename: this.connectionDescriptor[this.currentEnvironment.stage].credentialsFilePath.replace("~", homeDirectory)
                });
                return this._rawClient;

                // GetSecretValueCommand = exports.GetSecretValueCommand;
            })
        );

        return promises;
    }

    handleCreateTransactionOperation(createTransactionOperation) {
        /*
            SecetManagers typically doesn't have the notion of transaction, but we still need to find a way to make it work.
            TODO: For example, a Rollback would mean deleting what had been created.
        */
    }

    handleSecretReadOperation(readOperation) {
        /*
            Until we solve more efficiently (lazily) how RawDataServices listen for and receive data operations, we have to check wether we're the one to deal with this:
        */
        if(!this.handlesType(readOperation.target)) {
            return;
        }

        //console.log("S3DataService - handleObjectReadOperation");

        var self = this,
            data = readOperation.data,
            objectDescriptor = readOperation.target,
            mapping = objectDescriptor && this.mappingForType(objectDescriptor),
            primaryKeyPropertyDescriptors = mapping && mapping.primaryKeyPropertyDescriptors,

            criteria = readOperation.criteria,
            parameters = criteria.parameters,
            // iterator = new SyntaxInOrderIterator(criteria.syntax, "property"),
            secretId = parameters && parameters.name,
            rawData,
            promises,
            operation;

        if(secretId) {
            /*
                This params returns a data with these keys:
                ["AcceptRanges","LastModified","ContentLength","ETag","ContentType","ServerSideEncryption","Metadata","Body"]
            */

            (promises || (promises = [])).push(new Promise(function(resolve, reject) {

                self.rawClientPromise.then(() => {
                    // console.debug("GCP SecretManagerDataService fetch secret "+secretId);
                    var secretStore = self.connectionDescriptor[self.currentEnvironment.stage].secretStore,
                        secretName = secretStore.stringByAppendingPathComponent(secretId)+ "/versions/latest";

                    return self.rawClient.accessSecretVersion({
                        name: secretName
                      });
                })
                .then((response) => {
                    
                    // console.debug("GCP SecretManagerDataService fetch secret "+secretId+" complete: ",secretValue);

                      try {
                          // Extract the payload as a string.
                        const [version] = response,
                            secretStringValue = version.payload.data.toString();


                        try {
                            var secretValue = JSON.parse(secretStringValue);
                        } catch(parseError) {
                            //It's not jSON...
                            secretValue = secretStringValue;
                        }

                        (rawData || (rawData = {}))["name"] = secretId;
                        (rawData || (rawData = {}))["value"] = secretValue;

                        resolve(rawData);


                      } catch (err) {
                        console.log(err, err.stack); // an error occurred
                        (rawData || (rawData = {}))[data] = err;
                        reject(err);

                      }

                })
                .catch((error)=> {
                    if(error.details.includes("invalid_grant") && self.currentEnvironment.isLocalModding) {
                        console.warn("Error: User Re-Authentication needed. Run in terminal: \n\ngcloud auth application-default login\n\n", error);
                    } else {
                        return Promise.reject(error);
                    }
                });

            }));

        } else {
            console.log("Not sure what to send back, noOp?")
        }

        if(promises) {
            Promise.all(promises)
            .then(function(resolvedValue) {
                operation = self.responseOperationForReadOperation(readOperation, null, [rawData], false/*isNotLast*/);
                objectDescriptor.dispatchEvent(operation);
            }, function(error) {
                operation = self.responseOperationForReadOperation(readOperation, error, null, false/*isNotLast*/);
                objectDescriptor.dispatchEvent(operation);
            })
        } else {
            if(!rawData || (rawData && Object.keys(rawData).length === 0)) {
                operation = new DataOperation();
                operation.type = DataOperation.Type.NoOp;
            } else {
                operation = self.responseOperationForReadOperation(readOperation, null /*no error*/, [rawData], false/*isNotLast*/);
            }
            objectDescriptor.dispatchEvent(operation);
        }
    }

}
