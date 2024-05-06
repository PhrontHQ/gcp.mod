const RawDataService = require("mod/data/service/raw-data-service").RawDataService,
    //SyntaxInOrderIterator = (require)("mod/core/frb/syntax-iterator").SyntaxInOrderIterator,
    DataOperation = require("mod/data/service/data-operation").DataOperation;
var SecretManagerServiceClient;

    //Causes issues
    // secretObjectDescriptor = (require) ("app-infrastructure-data-mod/data/main.mod/model/secret.mjson").montageObject;

    /*
        https://cloud.google.com/nodejs/docs/reference/secret-manager/latest
        https://github.com/googleapis/google-cloud-node/blob/main/packages/google-cloud-secretmanager/package.json
        https://www.npmjs.com/package/@google-cloud/secret-manager
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
            for(var i=0, countI = plus.length, iObjectDescriptor; (i < countI); i++) {
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

    rawClientPromises() {
        var promises = super();

        /*
            This lazy load allows to reduce cold-start time, but to kick-start load of code in the phase that's not billed, at least on AWS
        */

        promises.push(
            // require.async("@aws-sdk/client-secrets-manager/dist-cjs/SecretsManagerClient").then(function(exports) { SecretsManagerClient = exports.SecretsManagerClient})
            require.async("@google-cloud/secret-manager").then(function(exports) {
                SecretManagerServiceClient = exports.v1.SecretManagerServiceClient;
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

                    const getSecretValueCommand = new GetSecretValueCommand({
                        SecretId: secretId
                    });
                    self.rawClient.send(getSecretValueCommand, function (err, data) {
                        if (err) {
                            /*

                                if (err.code === 'DecryptionFailureException')
                                    // Secrets Manager can't decrypt the protected secret text using the provided KMS key.
                                    // Deal with the exception here, and/or rethrow at your discretion.
                                    reject(err);
                                else if (err.code === 'InternalServiceErrorException')
                                    // An error occurred on the server side.
                                    // Deal with the exception here, and/or rethrow at your discretion.
                                    reject(err);
                                else if (err.code === 'InvalidParameterException')
                                    // You provided an invalid value for a parameter.
                                    // Deal with the exception here, and/or rethrow at your discretion.
                                    reject(err);
                                else if (err.code === 'InvalidRequestException')
                                    // You provided a parameter value that is not valid for the current state of the resource.
                                    // Deal with the exception here, and/or rethrow at your discretion.
                                    reject(err);
                                else if (err.code === 'ResourceNotFoundException')
                                    // We can't find the resource that you asked for.
                                    // Deal with the exception here, and/or rethrow at your discretion.
                                    reject(err);

                            */
                            console.log(err, err.stack); // an error occurred
                            (rawData || (rawData = {}))[data] = err;
                            reject(err);
                        }
                        else {
                            var secret, secretValue;
                            // Decrypts secret using the associated KMS CMK.
                            // Depending on whether the secret is a string or binary, one of these fields will be populated.
                            if ('SecretString' in data) {
                                secret = data.SecretString;
                                // console.log("secret:",secret);
                            } else {
                                let buff = new Buffer(data.SecretBinary, 'base64');
                                secret = decodedBinarySecret = buff.toString('ascii');
                                //console.log("decodedBinarySecret:",decodedBinarySecret);
                            }

                            try {
                                secretValue = JSON.parse(secret);
                            } catch(parseError) {
                                //It's not jSON...
                                secretValue = secret;
                            }
                            (rawData || (rawData = {}))["name"] = data.Name;
                            (rawData || (rawData = {}))["value"] = secretValue;

                            resolve(rawData);
                        }
                    });
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
