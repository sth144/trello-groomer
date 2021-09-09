import json
import re
import pandas as pd
import numpy as np
from nltk.corpus import stopwords
from nltk.stem import SnowballStemmer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.feature_selection import SelectKBest, chi2
from sklearn.svm import LinearSVC
from os import path

# TODO: use sklearn's built in neural network support
# TODO: break these parsing operations into their own functions
labels = None
if (path.exists("../../cache/labels.json")):
    with open("../../cache/labels.json") as data_file:
        text = data_file.read()
        labels = json.loads(text)

unlabeled_card_names = None
if (path.exists("../../cache/unlabeled.json")):
    with open("../../cache/unlabeled.json") as data_file:
        text = data_file.read()
        unlabeled_card_names = json.loads(text)

training_data = None
if (path.exists("../cache/label-data.json")):
    with open("../cache/label-data.json") as data_file:
        text = data_file.read()
        lines = text.split("[{")[1].split("}]")[0].split("},{")
        wrappedlines = []
        for line in lines:
            wrappedlines.append("{" + line + "}")
        joined_lines = "[" + ",".join(wrappedlines) + "]"
        training_data = json.loads(joined_lines)

data = pd.DataFrame(training_data)

stemmer = SnowballStemmer("english")
words = stopwords.words("english")

data["cleaned"] = data["name"].apply(
    lambda x: " ".join(
        [stemmer.stem(i) for i in re.sub("[^a-zA-Z]", " ", x).split() if i not in words]
    ).lower())

matches = []

for label in labels:
    data["label:"+label] = data["labels"].apply(
        lambda x: 1 if (labels[label] in x) else 0)

    X_train, X_test, y_train, y_test = train_test_split(data['cleaned'], data["label:"+label], test_size=0.2)

    if np.sum(y_train) in [len(y_train),0]:
        print("label: " + label + " only contains a single class")
    else:
        print("---------------------- running pipeline for class " + label + " ----------------------")
        # Pipeline is a pipeline of transforms collectively comprising an estimator
        # TfidVectorizer converts a collection of raw docs to a matrix of TF-IDF features (determines word importance)
        # SelectKBest selects features according to the k highest scores
        # LinearSVC vector classification
        pipeline = Pipeline([('vect', TfidfVectorizer(ngram_range=(1, 2), stop_words="english", sublinear_tf=True)),
                             ('chi',  SelectKBest(chi2, k=798)),
                             ('clf', LinearSVC(C=1.0, penalty='l1', max_iter=30000, dual=False))])

        model = pipeline.fit(X_train, y_train)

        print("accuracy score: " + str(model.score(X_test, y_test)))

        vectorizer = model.named_steps['vect']
        chi = model.named_steps['chi']
        clf = model.named_steps['clf']

        feature_names = vectorizer.get_feature_names()
        feature_names = [feature_names[i] for i in chi.get_support(indices=True)]
        feature_names = np.asarray(feature_names)

        target_names = ['1']
        print("top 15 keywords per class " + label + ":")
        for i, l in enumerate(target_names):
            top10 = np.argsort(clf.coef_[i])[-15:]
            print("%s: %s" % (l, " ".join(feature_names[top10])))


        predictions = model.predict(unlabeled_card_names)
        # print("predictions: " + str(predictions))
        i = 0
        for prediction in predictions:
            if prediction != 0:
                print("match: " + label + " -- " + unlabeled_card_names[i])
                matches.append({ label: unlabeled_card_names[i] })
            i += 1

print("Results: " + matches)
json.dump(matches, open("../../cache/label.model-output.json", "w+"))